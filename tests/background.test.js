"use strict";

const assert = require("node:assert/strict");

const STATE_KEY = "newsFeedPulseStateV1";
const POLL_ALARM = "news-feed-pulse-poll";
const FIXED_NOW = Date.parse("2026-10-21T16:00:00Z");
const originalDateNow = Date.now;
let now = FIXED_NOW;
Date.now = () => now;

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
let sendMessageFailuresRemaining = 0;
let redirectTarget = "https://redirect.test/old.xml";
const changeListeners = [];
const sentTabMessages = [];
const injectedScripts = [];
const alarms = new Map();
const fetchCalls = [];
let heldFeedFetch = null;
const feedItems = new Map([
  ["one.xml", ["one-0"]],
  ["two.xml", ["two-0"]],
  ["three.xml", ["three-0"]]
]);

function storageGet(keys) {
  if (keys === null) return { ...stored };
  if (typeof keys === "string") return Object.prototype.hasOwnProperty.call(stored, keys) ? { [keys]: stored[keys] } : {};
  if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in stored).map(key => [key, stored[key]]));
  const result = { ...keys };
  for (const key of Object.keys(keys || {})) if (key in stored) result[key] = stored[key];
  return result;
}

function eventSlot(assign) {
  return { addListener(listener) { assign(listener); } };
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
    onMessage: eventSlot(listener => { messageListener = listener; }),
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    getURL: path => `chrome-extension://test/${path}`
  },
  alarms: {
    get: async name => alarms.get(name) || null,
    clear: async name => alarms.delete(name),
    create: async (name, options) => {
      const alarm = {
        name,
        ...options,
        scheduledTime: Number(options.when) || now + Number(options.delayInMinutes || 0) * 60_000
      };
      alarms.set(name, alarm);
    },
    onAlarm: eventSlot(listener => { alarmListener = listener; })
  },
  tabs: {
    query: async () => [{ id: 1, url: "https://example.test/page", title: "Example", active: true }],
    sendMessage: async (tabId, message) => {
      if (sendMessageFailuresRemaining > 0) {
        sendMessageFailuresRemaining -= 1;
        throw new Error("Receiving end does not exist");
      }
      sentTabMessages.push({ tabId, message });
      return { accepted: true };
    },
    create: async () => {},
    onRemoved: { addListener: () => {} },
    onActivated: { addListener: () => {} },
    onUpdated: { addListener: () => {} }
  },
  scripting: {
    executeScript: async details => { injectedScripts.push(details); }
  }
};

global.importScripts = path => {
  if (path !== "rss-core.js") throw new Error(`Unexpected import: ${path}`);
  global.NewsFeedCore = require("../rss-core.js");
};

function rss(title, itemIds) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>https://example.test/</link>${itemIds.map((id, index) => `<item><guid>${id}</guid><title>Post ${id}</title><link>https://example.test/${id}</link><pubDate>Wed, 21 Oct 2026 ${String(15 - index).padStart(2, "0")}:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;
}

function responseAt(body, url, contentType = "application/rss+xml") {
  const response = new Response(body, { status: 200, headers: { "content-type": contentType } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

global.fetch = async url => {
  const href = String(url);
  fetchCalls.push(href);
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
  if (href === "https://fallback.test/feed") {
    return new Response(rss("Fallback feed", ["fallback-1"]), { status: 200, headers: { "content-type": "application/rss+xml" } });
  }
  const feedName = /\/([a-z0-9-]+\.xml)(?:$|[?#])/i.exec(href)?.[1];
  if (feedName && feedItems.has(feedName)) {
    if (heldFeedFetch) await heldFeedFetch.promise;
    const title = feedName.replace(/\.xml$/i, "").replace(/(^|-)([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
    return new Response(rss(title, feedItems.get(feedName)), { status: 200, headers: { "content-type": "application/rss+xml" } });
  }
  if (href.endsWith("/large.xml")) {
    return new Response(rss("Large", Array.from({ length: 60 }, (_value, index) => `large-${index}`)), {
      status: 200, headers: { "content-type": "application/rss+xml" }
    });
  }
  if (href.includes("redirect.test/") && href.endsWith(".xml")) {
    return responseAt(rss("Redirect", ["unchanged-guid"]), redirectTarget);
  }
  return new Response("missing", { status: 404 });
};

require("../local-background.js");

function request(type, data = {}, sender = {}) {
  return new Promise((resolve, reject) => {
    const keepAlive = messageListener({ type, data }, sender, response => {
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.message));
    });
    assert.equal(keepAlive, true);
  });
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

async function completeToast(index) {
  const delivery = sentTabMessages[index]?.message?.data;
  assert.ok(delivery?.deliveryId, `toast ${index + 1} should include a delivery lease`);
  await request("localToast:complete", { deliveryId: delivery.deliveryId }, { tab: { id: 1 } });
}

async function expectNextToast(index, title) {
  await waitFor(() => sentTabMessages.length > index, `toast ${index + 1} was not delivered`);
  assert.equal(sentTabMessages[index].message.type, "localToast:deliver");
  assert.equal(sentTabMessages[index].message.data.title, title);
  assert.equal(sentTabMessages[index].message.data.duration, 3000);
}

(async () => {
  const initial = await request("state:get");
  assert.equal(initial.feeds.length, 0);
  assert.equal(stored.legacyAuthToken, undefined);
  assert.equal(stored.localToastPosition, "bottom-left");
  assert.equal(stored.newsFeedPulseStandaloneVersion, 3);
  assert.equal(stored.localToastDuration, 3000, "old default toast durations should migrate to three seconds");
  assert.equal(stored.pollIntervalMinutes, 5);
  assert.equal(stored.maxPostsPerFeed, 50);

  sendMessageFailuresRemaining = 1;
  await request("toast:test");
  await waitFor(() => sentTabMessages.length === 1, "test toast was not delivered after content-script injection");
  assert.deepEqual(injectedScripts, [{ target: { tabId: 1 }, files: ["local-toast.js"] }]);
  assert.equal(sentTabMessages[0].message.type, "localToast:deliver");
  assert.equal(sentTabMessages[0].message.data.position, "bottom-left");
  assert.equal(sentTabMessages[0].message.data.duration, 3000);
  await completeToast(0);
  sentTabMessages.length = 0;
  injectedScripts.length = 0;

  const discovery = await request("feeds:discover", { url: "https://example.test/page" });
  assert.equal(discovery.kind, "directory");
  assert.deepEqual(discovery.candidates.map(feed => feed.title), ["One", "Two"]);
  const fallbackDiscovery = await request("feeds:discover", { url: "https://fallback.test/false-page" });
  assert.equal(fallbackDiscovery.candidates[0].url, "https://fallback.test/feed");

  const one = await request("feeds:add", { url: "https://example.test/one.xml" });
  const two = await request("feeds:add", { url: "https://example.test/two.xml" });
  assert.equal(one.added, true);
  assert.equal(one.state.posts[0].read, true);
  assert.equal(one.feed.toastEnabled, true);
  assert.equal(two.feed.toastEnabled, true);

  const scheduledFeeds = stored[STATE_KEY].feeds;
  const nextRefreshes = scheduledFeeds.map(feed => feed.nextRefreshAt);
  assert.ok(nextRefreshes.every(Number.isFinite), "every feed should persist its next refresh time");
  assert.equal(new Set(nextRefreshes).size, 2, "new feeds should be assigned different minute slots when slots are available");
  assert.ok(nextRefreshes.every(value => value >= now + 60_000 && value <= now + 5 * 60_000));
  const pollAlarm = alarms.get(POLL_ALARM);
  assert.ok(Number.isFinite(pollAlarm?.scheduledTime), "the earliest feed should schedule a one-shot alarm");
  assert.equal(pollAlarm.periodInMinutes, undefined, "polling should not use one synchronized repeating alarm");
  assert.equal(pollAlarm.scheduledTime, Math.min(...nextRefreshes));

  feedItems.set("one.xml", ["one-3", "one-2", "one-1", "one-0"]);
  feedItems.set("two.xml", ["two-3", "two-2", "two-1", "two-0"]);
  sentTabMessages.length = 0;
  const refreshed = await request("feeds:refresh");
  assert.equal(refreshed.state.unreadCount, 6);
  const fairOrder = ["Post one-3", "Post two-3", "Post one-2", "Post two-2", "Post one-1", "Post two-1"];
  for (let index = 0; index < fairOrder.length; index += 1) {
    await expectNextToast(index, fairOrder[index]);
    await completeToast(index);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sentTabMessages.length, fairOrder.length, "only three newest items per feed should be queued");

  const disabledState = await request("feeds:setToast", { feedId: two.feed.id, enabled: false });
  assert.equal(disabledState.feeds.find(feed => feed.id === two.feed.id).toastEnabled, false);
  feedItems.set("one.xml", ["one-4", "one-3", "one-2", "one-1", "one-0"]);
  feedItems.set("two.xml", ["two-4", "two-3", "two-2", "two-1", "two-0"]);
  sentTabMessages.length = 0;
  await request("feeds:refresh");
  await expectNextToast(0, "Post one-4");
  await completeToast(0);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sentTabMessages.length, 1, "a feed with toasts disabled must not enqueue notifications");

  const exported = await request("feeds:export");
  assert.equal(exported.format, "news-feed-pulse-feed-list");
  assert.equal(exported.version, 1);
  assert.deepEqual(Object.keys(exported.feeds[0]).sort(), ["title", "toastEnabled", "url"]);
  assert.equal(exported.feeds.find(feed => feed.url.endsWith("/two.xml")).toastEnabled, false);
  assert.equal(JSON.stringify(exported).includes("seenItem"), false, "export must not leak internal history");
  assert.equal(JSON.stringify(exported).includes("posts"), false, "export must not include article data");

  const imported = await request("feeds:import", {
    document: {
      format: "news-feed-pulse-feed-list",
      version: 1,
      feeds: [
        { url: "https://example.test/two.xml", title: "Ignored title", toastEnabled: true },
        { url: "https://example.test/three.xml", toastEnabled: false },
        { url: "https://user:secret@example.test/private.xml", toastEnabled: true }
      ]
    }
  });
  assert.equal(imported.added, 1);
  assert.equal(imported.existing, 1);
  assert.equal(imported.failed, 1);
  assert.equal(imported.state.feeds.find(feed => feed.id === two.feed.id).toastEnabled, true, "import should update an existing feed preference");
  assert.equal(imported.state.feeds.find(feed => feed.url.endsWith("/three.xml")).toastEnabled, false);
  await assert.rejects(
    request("feeds:import", {
      document: { format: "news-feed-pulse-feed-list", version: 1, feeds: [], padding: "x".repeat(1024 * 1024) }
    }),
    /larger than 1 MiB/,
    "the background must enforce the import size limit even when the UI is bypassed"
  );

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

  for (let index = 4; index <= 7; index += 1) {
    feedItems.set(`feed-${index}.xml`, [`feed-${index}-0`]);
    await request("feeds:add", { url: `https://example.test/feed-${index}.xml` });
  }
  stored.localToastEnabled = false;
  await request("settings:changed");
  const allFeeds = stored[STATE_KEY].feeds;
  for (const feed of allFeeds) feed.nextRefreshAt = now - 1000;
  fetchCalls.length = 0;
  alarmListener({ name: POLL_ALARM });
  const expectedBatchSize = Math.ceil(allFeeds.length / stored.pollIntervalMinutes);
  await waitFor(() => fetchCalls.length >= expectedBatchSize, "scheduled feed batch did not refresh");
  for (let attempt = 0; attempt < 5; attempt += 1) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fetchCalls.length, expectedBatchSize, "an overdue alarm should refresh only one staggered group");
  assert.ok(stored[STATE_KEY].feeds.every(feed => feed.nextRefreshAt > now), "claimed and deferred feeds should all receive future slots");

  // If the next one-shot alarm fires while the previous network batch is still
  // running, completion must recreate the consumed alarm instead of stalling.
  for (const feed of stored[STATE_KEY].feeds) feed.nextRefreshAt = now - 1000;
  let releaseHeldFetch;
  heldFeedFetch = { promise: new Promise(resolve => { releaseHeldFetch = resolve; }) };
  fetchCalls.length = 0;
  alarms.delete(POLL_ALARM);
  alarmListener({ name: POLL_ALARM });
  await waitFor(() => fetchCalls.length >= expectedBatchSize, "slow scheduled group did not start");
  await waitFor(() => Number.isFinite(alarms.get(POLL_ALARM)?.scheduledTime), "next one-shot alarm was not prepared");
  now = alarms.get(POLL_ALARM).scheduledTime + 1000;
  alarms.delete(POLL_ALARM);
  alarmListener({ name: POLL_ALARM });
  releaseHeldFetch();
  heldFeedFetch = null;
  await waitFor(() => Number.isFinite(alarms.get(POLL_ALARM)?.scheduledTime), "consumed overlapping alarm was not recreated");
  assert.ok(alarms.get(POLL_ALARM).scheduledTime >= now + 1000, "recreated alarm should target the next due group");

  Date.now = originalDateNow;
  console.log("background integration tests passed");
})().catch(error => {
  Date.now = originalDateNow;
  console.error(error);
  process.exitCode = 1;
});
