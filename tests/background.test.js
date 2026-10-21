"use strict";

const assert = require("node:assert/strict");

const stored = {
  legacyAuthToken: "remove-me",
  localToastPosition: "bottom-left",
  localToastDuration: 8000,
  pollIntervalMinutes: 15,
  maxPostsPerFeed: 150,
  newsFeedPulseStandaloneVersion: 1
};
let messageListener;
let alarmListener;
let version = 1;
let redirectTarget = "https://redirect.test/old.xml";
const changeListeners = [];
let createdAlarm = null;
const sentTabMessages = [];
const injectedScripts = [];
let sendMessageFailuresRemaining = 0;
let queriedTabs = [{ id: 1, url: "https://example.test/page", title: "Example", active: true }];
const blockedTabIds = new Set();

function storageGet(keys) {
  if (keys === null) return { ...stored };
  if (typeof keys === "string") return Object.prototype.hasOwnProperty.call(stored, keys) ? { [keys]: stored[keys] } : {};
  if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in stored).map(key => [key, stored[key]]));
  const result = { ...keys };
  for (const key of Object.keys(keys || {})) if (key in stored) result[key] = stored[key];
  return result;
}

global.chrome = {
  storage: {
    local: {
      get: async keys => storageGet(keys),
      set: async values => { Object.assign(stored, values); },
      clear: async () => { for (const key of Object.keys(stored)) delete stored[key]; }
    },
    onChanged: { addListener: listener => changeListeners.push(listener) }
  },
  action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
  runtime: {
    onMessage: { addListener: listener => { messageListener = listener; } },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    getURL: path => `chrome-extension://test/${path}`
  },
  alarms: {
    get: async () => null,
    clear: async () => true,
    create: (name, options) => { createdAlarm = { name, ...options }; },
    onAlarm: { addListener: listener => { alarmListener = listener; } }
  },
  tabs: {
    query: async () => queriedTabs,
    sendMessage: async (tabId, message) => {
      if (blockedTabIds.has(tabId)) throw new Error("This page blocks extension injection");
      if (sendMessageFailuresRemaining > 0) {
        sendMessageFailuresRemaining -= 1;
        throw new Error("Receiving end does not exist");
      }
      sentTabMessages.push({ tabId, message });
    },
    create: async () => {}, onRemoved: { addListener: () => {} }
  },
  scripting: {
    executeScript: async details => {
      if (blockedTabIds.has(details.target.tabId)) throw new Error("Cannot access this page");
      injectedScripts.push(details);
    }
  }
};

global.importScripts = path => {
  if (path !== "rss-core.js") throw new Error(`Unexpected import: ${path}`);
  global.NewsFeedCore = require("../rss-core.js");
};

function rss(title, itemIds) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://example.test/</link>${itemIds.map(id => `<item><guid>${id}</guid><title>Post ${id}</title><link>https://example.test/${id}</link><pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;
}

function responseAt(body, url, contentType = "application/rss+xml") {
  const response = new Response(body, { status: 200, headers: { "content-type": contentType } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

global.fetch = async url => {
  const href = String(url);
  if (href.endsWith("/page")) {
    return new Response(`<html><a href="/one.xml">RSS one</a><a href="/two.xml">RSS two</a></html>`, {
      status: 200, headers: { "content-type": "text/html" }
    });
  }
  if (href.endsWith("/false-page")) {
    return new Response(`<html><a href="/dead-rss.xml">RSS (retired)</a></html>`, {
      status: 200, headers: { "content-type": "text/html" }
    });
  }
  if (href === "https://fallback.test/feed") return new Response(rss("Fallback feed", ["fallback-1"]), { status: 200, headers: { "content-type": "application/rss+xml" } });
  if (href.endsWith("/one.xml")) {
    const items = version === 1 ? ["1"] : version === 2 ? ["2", "1"] : ["3", "2", "1"];
    return new Response(rss("One", items), { status: 200, headers: { "content-type": "application/rss+xml" } });
  }
  if (href.endsWith("/two.xml")) return new Response(rss("Two", ["a"]), { status: 200, headers: { "content-type": "application/rss+xml" } });
  if (href.endsWith("/large.xml")) return new Response(rss("Large", Array.from({ length: 60 }, (_value, index) => `large-${index}`)), { status: 200, headers: { "content-type": "application/rss+xml" } });
  if (href.includes("redirect.test/") && href.endsWith(".xml")) return responseAt(rss("Redirect", ["unchanged-guid"]), redirectTarget);
  return new Response("missing", { status: 404 });
};

require("../local-background.js");

function request(type, data = {}) {
  return new Promise((resolve, reject) => {
    const keepAlive = messageListener({ type, data }, {}, response => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.message));
    });
    assert.equal(keepAlive, true);
  });
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

(async () => {
  const initial = await request("state:get");
  assert.equal(initial.feeds.length, 0);
  assert.equal(stored.legacyAuthToken, undefined);
  assert.equal(stored.localToastPosition, "bottom-left");
  assert.equal(stored.newsFeedPulseStandaloneVersion, 2);
  assert.equal(stored.localToastDuration, 300000);
  assert.equal(stored.pollIntervalMinutes, 5);
  assert.equal(stored.maxPostsPerFeed, 50);
  await request("settings:changed");
  assert.equal(createdAlarm.periodInMinutes, 5);

  sendMessageFailuresRemaining = 1;
  await request("toast:test");
  assert.deepEqual(injectedScripts, [{ target: { tabId: 1 }, files: ["local-toast.js"] }]);
  assert.equal(sentTabMessages.length, 1);
  assert.equal(sentTabMessages[0].tabId, 1);
  assert.equal(sentTabMessages[0].message.type, "localToast:show");
  assert.equal(sentTabMessages[0].message.data.position, "bottom-left");
  assert.equal(sentTabMessages[0].message.data.duration, 300000);
  sentTabMessages.length = 0;
  injectedScripts.length = 0;

  queriedTabs = [
    { id: 2, url: "https://chromewebstore.google.com/detail/example", active: true, lastAccessed: 2 },
    { id: 1, url: "https://example.test/page", active: false, lastAccessed: 1 }
  ];
  blockedTabIds.add(2);
  await request("toast:test");
  assert.equal(sentTabMessages.length, 1, "toast delivery should retry another webpage tab");
  assert.equal(sentTabMessages[0].tabId, 1);
  blockedTabIds.clear();
  queriedTabs = [{ id: 1, url: "https://example.test/page", title: "Example", active: true }];
  sentTabMessages.length = 0;
  injectedScripts.length = 0;

  stored.localToastDuration = 3000;
  await request("settings:changed");
  await request("toast:test");
  assert.equal(sentTabMessages[0].message.data.duration, 3000, "three-second toast setting should reach the webpage");
  stored.localToastDuration = 300000;
  await request("settings:changed");
  sentTabMessages.length = 0;

  const discovery = await request("feeds:discover", { url: "https://example.test/page" });
  assert.equal(discovery.kind, "directory");
  assert.deepEqual(discovery.candidates.map(feed => feed.title), ["One", "Two"]);

  const suppliedDiscovery = await request("feeds:discover", {
    url: "https://blocked.test/",
    candidates: [{ url: "https://example.test/two.xml", title: "Page-declared feed" }]
  });
  assert.equal(suppliedDiscovery.candidates[0].title, "Two");

  const fallbackDiscovery = await request("feeds:discover", { url: "https://fallback.test/false-page" });
  assert.equal(fallbackDiscovery.candidates[0].url, "https://fallback.test/feed");

  const added = await request("feeds:add", { url: "https://example.test/one.xml" });
  assert.equal(added.added, true);
  assert.equal(added.importedPosts, 1);
  assert.equal(added.state.posts[0].read, true);

  version = 2;
  const refreshed = await request("feeds:refresh", { feedId: added.feed.id });
  assert.equal(refreshed.state.posts.length, 2);
  assert.equal(refreshed.state.unreadCount, 1);
  assert.equal(sentTabMessages.length, 1, "manual refresh should deliver a toast for a new item");
  assert.equal(sentTabMessages[0].message.data.title, "Post 2");
  sentTabMessages.length = 0;

  version = 3;
  alarmListener({ name: "news-feed-pulse-poll" });
  await waitFor(() => sentTabMessages.length === 1, "alarm refresh did not deliver an in-page toast");
  assert.equal(sentTabMessages[0].tabId, 1);
  assert.equal(sentTabMessages[0].message.type, "localToast:show");
  assert.equal(sentTabMessages[0].message.data.title, "Post 3");
  assert.equal(sentTabMessages[0].message.data.link, "https://example.test/3");
  sentTabMessages.length = 0;

  const large = await request("feeds:add", { url: "https://example.test/large.xml" });
  assert.equal(large.importedPosts, 60);
  assert.equal(large.state.posts.filter(post => post.feedId === large.feed.id).length, 50);
  const largeRefresh = await request("feeds:refresh", { feedId: large.feed.id });
  assert.equal(
    largeRefresh.state.posts.filter(post => post.feedId === large.feed.id && !post.read).length,
    0,
    "trimmed historical items must not become unread again"
  );

  const redirected = await request("feeds:add", { url: "https://redirect.test/source.xml" });
  redirectTarget = "https://redirect.test/new.xml";
  const redirectRefresh = await request("feeds:refresh", { feedId: redirected.feed.id });
  assert.equal(redirectRefresh.result.newPosts.length, 0, "a feed redirect must not change existing post identity");
  assert.equal(redirectRefresh.state.posts.filter(post => post.feedId === redirected.feed.id).length, 1);
  console.log("background integration tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
