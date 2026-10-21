"use strict";

importScripts("rss-core.js");

const Core = globalThis.NewsFeedCore;
const STATE_KEY = "newsFeedPulseStateV1";
const POLL_ALARM = "news-feed-pulse-poll";
const STANDALONE_VERSION = 2;
const DEFAULT_SETTINGS = Object.freeze({
  localToastEnabled: true,
  localToastPosition: "top-right",
  localToastDuration: 300000,
  pollIntervalMinutes: 5,
  maxPostsPerFeed: 50
});
const PREVIOUS_DEFAULT_SETTINGS = Object.freeze({
  localToastDuration: 8000,
  pollIntervalMinutes: 15,
  maxPostsPerFeed: 150
});
const FETCH_TIMEOUT_MS = 20000;
const MAX_DISCOVERY_VALIDATIONS = 40;
const activePageFeeds = new Map();
let mutationQueue = Promise.resolve();

function emptyState() {
  return { version: 1, feeds: [], posts: [] };
}

async function deleteLegacyDatabases() {
  try {
    if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      for (const database of databases) {
        if (!database.name) continue;
        await new Promise(resolve => {
          const request = indexedDB.deleteDatabase(database.name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        });
      }
    }
  } catch (_error) {}
  try {
    for (const cacheName of await caches.keys()) await caches.delete(cacheName);
  } catch (_error) {}
}

async function migrateLegacyData() {
  const all = await chrome.storage.local.get(null);
  const storedVersion = Number(all.newsFeedPulseStandaloneVersion) || 0;
  if (storedVersion >= STANDALONE_VERSION) {
    await deleteLegacyDatabases();
    return;
  }
  const migratingPreviousDefaults = storedVersion === 1;
  const migratedSetting = (value, previousDefault, nextDefault) =>
    migratingPreviousDefaults && Number(value) === previousDefault ? nextDefault : value;
  const settings = {
    localToastEnabled: all.localToastEnabled !== false,
    localToastPosition: ["top-right", "top-left", "bottom-right", "bottom-left"].includes(all.localToastPosition)
      ? all.localToastPosition : DEFAULT_SETTINGS.localToastPosition,
    localToastDuration: clampNumber(
      migratedSetting(all.localToastDuration, PREVIOUS_DEFAULT_SETTINGS.localToastDuration, DEFAULT_SETTINGS.localToastDuration),
      2000, 300000, DEFAULT_SETTINGS.localToastDuration
    ),
    pollIntervalMinutes: clampNumber(
      migratedSetting(all.pollIntervalMinutes, PREVIOUS_DEFAULT_SETTINGS.pollIntervalMinutes, DEFAULT_SETTINGS.pollIntervalMinutes),
      1, 1440, DEFAULT_SETTINGS.pollIntervalMinutes
    ),
    maxPostsPerFeed: clampNumber(
      migratedSetting(all.maxPostsPerFeed, PREVIOUS_DEFAULT_SETTINGS.maxPostsPerFeed, DEFAULT_SETTINGS.maxPostsPerFeed),
      25, 500, DEFAULT_SETTINGS.maxPostsPerFeed
    )
  };
  const standaloneState = all[STATE_KEY];
  const state = standaloneState && Array.isArray(standaloneState.feeds) && Array.isArray(standaloneState.posts)
    ? standaloneState : emptyState();
  try { if (chrome.storage.sync?.clear) await chrome.storage.sync.clear(); } catch (_error) {}
  try { if (chrome.storage.session?.clear) await chrome.storage.session.clear(); } catch (_error) {}
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ ...settings, [STATE_KEY]: state, newsFeedPulseStandaloneVersion: STANDALONE_VERSION });
  await trimPosts(state);
  await chrome.storage.local.set({ [STATE_KEY]: state });
  await deleteLegacyDatabases();
}

const initialization = migrateLegacyData();

function runLocked(task) {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => undefined);
  return run;
}

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const value = stored[STATE_KEY];
  if (!value || !Array.isArray(value.feeds) || !Array.isArray(value.posts)) return emptyState();
  return { version: 1, feeds: value.feeds, posts: value.posts };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  await updateBadge(state);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    localToastEnabled: stored.localToastEnabled !== false,
    localToastPosition: ["top-right", "top-left", "bottom-right", "bottom-left"].includes(stored.localToastPosition)
      ? stored.localToastPosition : DEFAULT_SETTINGS.localToastPosition,
    localToastDuration: clampNumber(stored.localToastDuration, 2000, 300000, DEFAULT_SETTINGS.localToastDuration),
    pollIntervalMinutes: clampNumber(stored.pollIntervalMinutes, 1, 1440, DEFAULT_SETTINGS.pollIntervalMinutes),
    maxPostsPerFeed: clampNumber(stored.maxPostsPerFeed, 25, 500, DEFAULT_SETTINGS.maxPostsPerFeed)
  };
}

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function publicState(state) {
  const feeds = state.feeds.map(feed => {
    const { seenItemIds: _seenItemIds, seenItemKeys: _seenItemKeys, ...publicFeed } = feed;
    return publicFeed;
  });
  const feedById = new Map(feeds.map(feed => [feed.id, feed]));
  const posts = state.posts.map(post => ({
    ...post,
    feedTitle: feedById.get(post.feedId)?.title || "RSS feed"
  })).sort((left, right) => (right.sortAt || 0) - (left.sortAt || 0));
  return { feeds, posts, unreadCount: posts.filter(post => !post.read).length };
}

async function updateBadge(state) {
  const value = state || await getState();
  const unread = value.posts.reduce((total, post) => total + (post.read ? 0 : 1), 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#6657d9" });
  await chrome.action.setBadgeText({ text: unread ? (unread > 999 ? "999+" : String(unread)) : "" });
}

function normalizeInput(value) {
  let input = String(value || "").trim();
  const markdown = input.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/i);
  if (markdown) input = markdown[1];
  const url = Core.normalizeHttpUrl(input);
  if (!url) throw userError("INVALID_URL", "Enter a valid HTTP or HTTPS website or feed URL.");
  return url;
}

function userError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

async function readResponseText(response, controller) {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > Core.MAX_DOCUMENT_BYTES) {
    controller.abort();
    throw userError("TOO_LARGE", "That page is too large to inspect safely.");
  }
  const text = await response.text();
  if (text.length > Core.MAX_DOCUMENT_BYTES) throw userError("TOO_LARGE", "That page is too large to inspect safely.");
  return text;
}

async function fetchDocument(url, conditional = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9, */*;q=0.5"
  };
  if (conditional.etag) headers["If-None-Match"] = conditional.etag;
  if (conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 304) {
      return { notModified: true, url: response.url || url, headers: response.headers };
    }
    if (!response.ok) throw userError("HTTP_STATUS", `The server returned HTTP ${response.status}.`);
    const text = await readResponseText(response, controller);
    return {
      notModified: false,
      url: response.url || url,
      contentType: response.headers.get("content-type") || "",
      etag: response.headers.get("etag") || "",
      lastModified: response.headers.get("last-modified") || "",
      text
    };
  } catch (error) {
    if (error?.name === "AbortError") throw userError("TIMEOUT", "The website took too long to respond.");
    if (error?.code) throw error;
    throw userError("NETWORK_ERROR", "The extension could not download that URL. Check the address and try again.");
  } finally {
    clearTimeout(timeout);
  }
}

async function loadFeed(url, conditional) {
  const document = await fetchDocument(url, conditional);
  if (document.notModified) return document;
  const parsed = Core.parseFeed(document.text, document.url, document.contentType);
  if (!parsed) throw userError("NOT_A_FEED", "The URL did not return a valid RSS, Atom, RDF, or JSON feed.");
  return { ...document, parsed };
}

async function validateCandidate(candidate) {
  try {
    const loaded = await loadFeed(candidate.url);
    return {
      url: loaded.url,
      title: loaded.parsed.title || candidate.title,
      format: loaded.parsed.format,
      itemCount: loaded.parsed.items.length,
      siteUrl: loaded.parsed.siteUrl || null
    };
  } catch (_error) {
    return null;
  }
}

async function validateCandidates(candidates) {
  const queue = candidates.slice(0, MAX_DISCOVERY_VALIDATIONS);
  const valid = [];
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const candidate = queue[cursor];
      cursor += 1;
      const result = await validateCandidate(candidate);
      if (result) valid.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
  const unique = new Map();
  for (const feed of valid) if (!unique.has(feed.url)) unique.set(feed.url, feed);
  const results = Array.from(unique.values());
  const titleCounts = new Map();
  for (const feed of results) {
    const key = feed.title.trim().toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  return results.map(feed => {
    if (titleCounts.get(feed.title.trim().toLowerCase()) < 2) return feed;
    let suffix = "feed";
    try {
      const url = new URL(feed.url);
      suffix = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname)
        .replace(/\.(?:xml|rss|atom|rdf|json)$/i, "")
        .replace(/[-_]+/g, " ");
    } catch (_error) {}
    return { ...feed, title: `${feed.title} — ${suffix}` };
  });
}

async function discoverFeeds(value, suppliedCandidates = []) {
  const inputUrl = normalizeInput(value);
  const supplied = dedupeCandidates(suppliedCandidates);
  if (supplied.length) {
    const validSupplied = await validateCandidates(supplied);
    if (validSupplied.length) {
      validSupplied.sort((left, right) => left.title.localeCompare(right.title));
      return {
        kind: validSupplied.length === 1 ? "feed" : "directory",
        sourceUrl: inputUrl,
        candidates: validSupplied
      };
    }
  }
  const document = await fetchDocument(inputUrl, {}, 45000);
  const direct = Core.parseFeed(document.text, document.url, document.contentType);
  if (direct) {
    return {
      kind: "feed",
      sourceUrl: document.url,
      candidates: [{
        url: document.url, title: direct.title, format: direct.format,
        itemCount: direct.items.length, siteUrl: direct.siteUrl || null
      }]
    };
  }

  const pageCandidates = Core.extractFeedCandidates(document.text, document.url);
  for (const candidate of supplied) {
    const url = Core.normalizeHttpUrl(candidate?.url, document.url);
    if (url) pageCandidates.unshift({ url, title: candidate.title || "Discovered feed" });
  }
  let candidates = dedupeCandidates(pageCandidates);
  const usedCommonCandidates = candidates.length === 0;
  if (usedCommonCandidates) candidates = Core.commonFeedCandidates(document.url);
  let valid = await validateCandidates(candidates);
  if (!valid.length && !usedCommonCandidates) {
    const attempted = new Set(candidates.map(candidate => candidate.url));
    valid = await validateCandidates(Core.commonFeedCandidates(document.url).filter(candidate => !attempted.has(candidate.url)));
  }
  if (!valid.length) {
    throw userError("NO_FEEDS_FOUND", "No working RSS or Atom feeds were found on that page. Try pasting a direct feed URL.");
  }
  valid.sort((left, right) => left.title.localeCompare(right.title));
  return { kind: valid.length === 1 ? "feed" : "directory", sourceUrl: document.url, candidates: valid };
}

function dedupeCandidates(candidates) {
  const unique = new Map();
  for (const candidate of candidates || []) {
    const url = Core.normalizeHttpUrl(candidate?.url);
    if (url && !unique.has(url)) unique.set(url, { url, title: candidate.title || "RSS feed" });
  }
  return Array.from(unique.values());
}

function itemKey(item) {
  return Core.stableHash(item.guid || item.link || `${item.title || ""}|${item.publishedAt || ""}`);
}

function storedPostId(item, feedId) {
  return Core.stableHash(`${feedId}|${itemKey(item)}`);
}

function toStoredPost(item, feedId, now, read) {
  const publishedTime = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
  return {
    id: storedPostId(item, feedId),
    feedId,
    guid: item.guid || "",
    title: item.title || "Untitled item",
    link: item.link || null,
    summary: item.summary || "",
    author: item.author || "",
    publishedAt: item.publishedAt || null,
    sortAt: Number.isFinite(publishedTime) ? publishedTime : now,
    firstSeenAt: now,
    imageUrl: item.imageUrl || null,
    read: Boolean(read),
    starred: false
  };
}

async function addFeed(value) {
  const requestedUrl = normalizeInput(value);
  const loaded = await loadFeed(requestedUrl);
  const now = Date.now();
  return runLocked(async () => {
    const state = await getState();
    const canonicalUrl = Core.normalizeHttpUrl(loaded.url) || requestedUrl;
    const existing = state.feeds.find(feed => feed.url === canonicalUrl || feed.requestedUrl === requestedUrl);
    if (existing) return { added: false, feed: existing, state: publicState(state) };
    const feedId = `feed-${Core.stableHash(canonicalUrl)}`;
    const feed = {
      id: feedId,
      url: canonicalUrl,
      requestedUrl,
      title: loaded.parsed.title || new URL(canonicalUrl).hostname,
      siteUrl: loaded.parsed.siteUrl || null,
      description: loaded.parsed.description || "",
      format: loaded.parsed.format,
      addedAt: now,
      lastFetchedAt: now,
      etag: loaded.etag || "",
      lastModified: loaded.lastModified || "",
      seenItemKeys: loaded.parsed.items.map(itemKey).slice(0, 2000),
      error: null
    };
    state.feeds.push(feed);
    const initialPosts = loaded.parsed.items.map(item => toStoredPost(item, feedId, now, true));
    state.posts.push(...initialPosts);
    await trimPosts(state);
    await saveState(state);
    return { added: true, feed, importedPosts: initialPosts.length, state: publicState(state) };
  });
}

async function trimPosts(state) {
  const settings = await getSettings();
  const kept = [];
  for (const feed of state.feeds) {
    const posts = state.posts.filter(post => post.feedId === feed.id)
      .sort((left, right) => (right.sortAt || 0) - (left.sortAt || 0));
    const starred = posts.filter(post => post.starred).slice(0, settings.maxPostsPerFeed);
    const regular = posts.filter(post => !post.starred)
      .slice(0, Math.max(0, settings.maxPostsPerFeed - starred.length));
    kept.push(...starred, ...regular);
  }
  const unique = new Map();
  for (const post of kept) if (!unique.has(`${post.feedId}|${post.id}`)) unique.set(`${post.feedId}|${post.id}`, post);
  state.posts = Array.from(unique.values());
}

async function refreshFeed(feedId, notify = true) {
  const before = await getState();
  const feed = before.feeds.find(value => value.id === feedId);
  if (!feed) return { removed: true, newPosts: [] };
  let loaded;
  try {
    loaded = await loadFeed(feed.url, { etag: feed.etag, lastModified: feed.lastModified });
  } catch (error) {
    await runLocked(async () => {
      const state = await getState();
      const storedFeed = state.feeds.find(value => value.id === feedId);
      if (storedFeed) {
        storedFeed.lastFetchedAt = Date.now();
        storedFeed.error = error.message || String(error);
        await saveState(state);
      }
    });
    return { error: error.message || String(error), newPosts: [] };
  }

  if (loaded.notModified) {
    await runLocked(async () => {
      const state = await getState();
      const storedFeed = state.feeds.find(value => value.id === feedId);
      if (storedFeed) {
        storedFeed.lastFetchedAt = Date.now();
        storedFeed.error = null;
        await saveState(state);
      }
    });
    return { notModified: true, newPosts: [] };
  }

  const result = await runLocked(async () => {
    const state = await getState();
    const storedFeed = state.feeds.find(value => value.id === feedId);
    if (!storedFeed) return { removed: true, newPosts: [] };
    const now = Date.now();
    const retainedPosts = state.posts.filter(post => post.feedId === feedId);
    const retainedKeys = retainedPosts.map(itemKey);
    const knownKeys = new Set([...(storedFeed.seenItemKeys || []), ...retainedKeys]);
    const newPosts = loaded.parsed.items.filter(item => !knownKeys.has(itemKey(item)))
      .map(item => toStoredPost(item, feedId, now, false));
    state.posts.push(...newPosts);
    storedFeed.url = Core.normalizeHttpUrl(loaded.url) || storedFeed.url;
    storedFeed.title = loaded.parsed.title || storedFeed.title;
    storedFeed.siteUrl = loaded.parsed.siteUrl || storedFeed.siteUrl;
    storedFeed.description = loaded.parsed.description || storedFeed.description;
    storedFeed.format = loaded.parsed.format;
    storedFeed.lastFetchedAt = now;
    storedFeed.etag = loaded.etag || storedFeed.etag || "";
    storedFeed.lastModified = loaded.lastModified || storedFeed.lastModified || "";
    storedFeed.seenItemKeys = Array.from(new Set([
      ...loaded.parsed.items.map(itemKey),
      ...(storedFeed.seenItemKeys || []),
      ...retainedKeys
    ])).slice(0, 2000);
    storedFeed.error = null;
    await trimPosts(state);
    await saveState(state);
    return { newPosts, feed: { ...storedFeed } };
  });

  if (notify && result.newPosts?.length) {
    for (const post of result.newPosts.slice(0, 3).reverse()) await showPostToast(post, result.feed);
  }
  return result;
}

async function refreshAll(notify = true) {
  const state = await getState();
  const feedIds = state.feeds.map(feed => feed.id);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < feedIds.length) {
      const feedId = feedIds[cursor];
      cursor += 1;
      results.push(await refreshFeed(feedId, notify));
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, feedIds.length) }, () => worker()));
  return { results, state: publicState(await getState()) };
}

async function showPostToast(post, feed) {
  const settings = await getSettings();
  if (!settings.localToastEnabled) return false;
  const tab = await findToastTab();
  if (!tab) return false;
  return sendToastToTab(tab.id, {
    postId: post.id,
    title: post.title,
    message: feed?.title || "New RSS item",
    link: post.link,
    position: settings.localToastPosition,
    duration: settings.localToastDuration,
    iconUrl: chrome.runtime.getURL("extension-icons/icon48x48.png")
  });
}

async function findToastTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(value => value.id && /^https?:/i.test(value.url || ""))
    .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0) || Number(right.active) - Number(left.active))[0] || null;
}

async function sendToastToTab(tabId, data) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "localToast:show", data });
    return true;
  } catch (_error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["local-toast.js"] });
      await chrome.tabs.sendMessage(tabId, { type: "localToast:show", data });
      return true;
    } catch (_injectionError) {
      return false;
    }
  }
}

async function removeFeed(feedId) {
  if (typeof feedId !== "string" || !feedId) throw userError("INVALID_FEED", "A feed must be selected.");
  return runLocked(async () => {
    const state = await getState();
    state.feeds = state.feeds.filter(feed => feed.id !== feedId);
    state.posts = state.posts.filter(post => post.feedId !== feedId);
    await saveState(state);
    return publicState(state);
  });
}

async function updatePost(postId, patch) {
  if (typeof postId !== "string" || !postId) throw userError("INVALID_POST", "A post must be selected.");
  return runLocked(async () => {
    const state = await getState();
    const post = state.posts.find(value => value.id === postId);
    if (!post) throw userError("POST_NOT_FOUND", "That post is no longer stored.");
    if (Object.prototype.hasOwnProperty.call(patch, "read")) post.read = Boolean(patch.read);
    if (Object.prototype.hasOwnProperty.call(patch, "starred")) post.starred = Boolean(patch.starred);
    await saveState(state);
    return publicState(state);
  });
}

async function markAllRead(feedId) {
  return runLocked(async () => {
    const state = await getState();
    for (const post of state.posts) if (!feedId || post.feedId === feedId) post.read = true;
    await saveState(state);
    return publicState(state);
  });
}

async function openPost(postId) {
  const state = await getState();
  const post = state.posts.find(value => value.id === postId);
  if (!post?.link || !Core.normalizeHttpUrl(post.link)) throw userError("NO_ARTICLE_URL", "This item does not include an article link.");
  await updatePost(postId, { read: true });
  await chrome.tabs.create({ url: post.link });
  return true;
}

async function getActivePage() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !/^https?:/i.test(tab.url || "")) return { url: "", title: "", candidates: [] };
  const normalizedTabUrl = Core.normalizeHttpUrl(tab.url);
  const cached = activePageFeeds.get(tab.id);
  return {
    url: tab.url,
    title: tab.title || "",
    candidates: cached?.pageUrl === normalizedTabUrl ? cached.candidates : []
  };
}

async function configureAlarm(force = false) {
  const settings = await getSettings();
  const existing = await chrome.alarms.get(POLL_ALARM);
  if (!force && existing && Number(existing.periodInMinutes) === settings.pollIntervalMinutes) return;
  if (existing) await chrome.alarms.clear(POLL_ALARM);
  chrome.alarms.create(POLL_ALARM, { delayInMinutes: settings.pollIntervalMinutes, periodInMinutes: settings.pollIntervalMinutes });
}

async function handleMessage(message, sender) {
  await initialization;
  const type = message?.type;
  const data = message?.data || {};
  switch (type) {
    case "state:get": return publicState(await getState());
    case "feeds:discover": return discoverFeeds(data.url, data.candidates);
    case "feeds:add": return addFeed(data.url);
    case "feeds:remove": return removeFeed(data.feedId);
    case "feeds:refresh": return data.feedId
      ? { result: await refreshFeed(data.feedId, false), state: publicState(await getState()) }
      : refreshAll(false);
    case "posts:update": return updatePost(data.postId, data.patch || {});
    case "posts:markAllRead": return markAllRead(data.feedId);
    case "posts:open": return openPost(data.postId);
    case "page:active": return getActivePage();
    case "settings:changed": {
      await configureAlarm(true);
      await runLocked(async () => {
        const state = await getState();
        await trimPosts(state);
        await saveState(state);
      });
      return getSettings();
    }
    case "toast:test": {
      const settings = await getSettings();
      const tab = await findToastTab();
      if (!tab) throw userError("NO_WEB_TAB", "Open a normal website tab first, then test the toast.");
      const sent = await sendToastToTab(tab.id, {
        title: "Toast notifications are working",
        message: "New RSS items will appear here.",
        position: settings.localToastPosition,
        duration: settings.localToastDuration,
        iconUrl: chrome.runtime.getURL("extension-icons/icon48x48.png")
      });
      if (!sent) throw userError("TOAST_UNAVAILABLE", "The toast could not be shown on this page. Try a standard HTTP or HTTPS tab.");
      return true;
    }
    case "page:feeds": {
      if (sender.tab?.id) activePageFeeds.set(sender.tab.id, {
        pageUrl: Core.normalizeHttpUrl(data.pageUrl || sender.tab.url),
        candidates: dedupeCandidates(data.candidates || [])
      });
      return true;
    }
    case "localToast:open": {
      if (typeof data.postId === "string" && data.postId) {
        try { await openPost(data.postId); return true; }
        catch (_error) {}
      }
      const url = Core.normalizeHttpUrl(data.url);
      if (url) await chrome.tabs.create({ url });
      return Boolean(url);
    }
    default: throw userError("UNKNOWN_REQUEST", "The extension received an unknown local request.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({
      ok: false,
      error: { code: error?.code || "UNEXPECTED_ERROR", message: error?.message || String(error), details: error?.details }
    }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  initialization.then(() => configureAlarm(true)).then(() => updateBadge()).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  configureAlarm().then(() => updateBadge()).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM) refreshAll(true).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener(tabId => activePageFeeds.delete(tabId));

initialization.then(configureAlarm).then(() => updateBadge()).catch(() => undefined);
