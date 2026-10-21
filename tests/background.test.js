"use strict";

const assert = require("node:assert/strict");

const stored = { legacyAuthToken: "remove-me", localToastPosition: "bottom-left" };
let messageListener;
let version = 1;
let redirectTarget = "https://redirect.test/old.xml";
const changeListeners = [];

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
  alarms: { get: async () => null, clear: async () => true, create: () => {}, onAlarm: { addListener: () => {} } },
  tabs: {
    query: async () => [{ id: 1, url: "https://example.test/page", title: "Example" }],
    sendMessage: async () => {}, create: async () => {}, onRemoved: { addListener: () => {} }
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
  if (href.endsWith("/one.xml")) return new Response(rss("One", version === 1 ? ["1"] : ["2", "1"]), { status: 200, headers: { "content-type": "application/rss+xml" } });
  if (href.endsWith("/two.xml")) return new Response(rss("Two", ["a"]), { status: 200, headers: { "content-type": "application/rss+xml" } });
  if (href.endsWith("/large.xml")) return new Response(rss("Large", Array.from({ length: 30 }, (_value, index) => `large-${index}`)), { status: 200, headers: { "content-type": "application/rss+xml" } });
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

(async () => {
  const initial = await request("state:get");
  assert.equal(initial.feeds.length, 0);
  assert.equal(stored.legacyAuthToken, undefined);
  assert.equal(stored.localToastPosition, "bottom-left");
  assert.equal(stored.newsFeedPulseStandaloneVersion, 1);

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

  const large = await request("feeds:add", { url: "https://example.test/large.xml" });
  assert.equal(large.importedPosts, 30);
  const largeRefresh = await request("feeds:refresh", { feedId: large.feed.id });
  assert.equal(largeRefresh.state.unreadCount, 1, "trimmed historical items must not become unread again");

  const redirected = await request("feeds:add", { url: "https://redirect.test/source.xml" });
  redirectTarget = "https://redirect.test/new.xml";
  const redirectRefresh = await request("feeds:refresh", { feedId: redirected.feed.id });
  assert.equal(redirectRefresh.result.newPosts.length, 0, "a feed redirect must not change existing post identity");
  assert.equal(redirectRefresh.state.posts.filter(post => post.feedId === redirected.feed.id).length, 1);
  console.log("background integration tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
