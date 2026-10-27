"use strict";

importScripts("rss-core.js", "news-sources.js");

const Core = globalThis.NewsFeedCore;
const STATE_KEY = "newsFeedPulseStateV1";
const POLL_ALARM = "news-feed-pulse-poll";
const TOAST_RETRY_ALARM = "news-feed-pulse-toast-retry";
const TOAST_STATE_KEY = "newsFeedPulseToastQueueV1";
const SCHEDULE_INTERVAL_KEY = "newsFeedPulseScheduleInterval";
const DEFAULT_FEEDS_PENDING_KEY = "newsFeedPulsePendingDefaultFeeds";
const BROWSER_SESSION_KEY = "newsFeedPulseBrowserSessionReady";
const STANDALONE_VERSION = 3;
const DEFAULT_SETTINGS = Object.freeze({
  localToastEnabled: true,
  localToastPosition: "top-right",
  localToastDuration: 3000,
  pollIntervalMinutes: 5,
  maxPostsPerFeed: 50
});
const DEFAULT_FEED_URLS = (globalThis.NewsFeedPulseSourceCategories || [])
  .flatMap(category => category.sources || [])
  .filter(source => source.defaultFollowed)
  .map(source => source.url);
const VERSION_1_DEFAULT_SETTINGS = Object.freeze({
  localToastDuration: 8000,
  pollIntervalMinutes: 15,
  maxPostsPerFeed: 150
});
const VERSION_2_DEFAULT_SETTINGS = Object.freeze({ localToastDuration: 300000 });
const FETCH_TIMEOUT_MS = 20000;
const MAX_DISCOVERY_VALIDATIONS = 40;
const MINUTE_MS = 60 * 1000;
const SCHEDULE_GRACE_MS = 5000;
const TOAST_LEASE_GRACE_MS = 15000;
const TOAST_RETRY_DELAY_MS = 10000;
const MAX_TOAST_QUEUE = 500;
const MAX_IMPORT_DOCUMENT_BYTES = 1024 * 1024;
const activePageFeeds = new Map();
const loadingToastTabs = new Set();
let mutationQueue = Promise.resolve();
let toastMutationQueue = Promise.resolve();
let alarmMutationQueue = Promise.resolve();
let toastDispatchQueue = Promise.resolve();
let scheduledPollRun = null;
let browserSessionReady = null;

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
  let storedToastDuration = all.localToastDuration;
  if (storedVersion === 1 && Number(storedToastDuration) === VERSION_1_DEFAULT_SETTINGS.localToastDuration) {
    storedToastDuration = DEFAULT_SETTINGS.localToastDuration;
  }
  if (storedVersion === 2 && Number(storedToastDuration) === VERSION_2_DEFAULT_SETTINGS.localToastDuration) {
    storedToastDuration = DEFAULT_SETTINGS.localToastDuration;
  }
  const migratedV1Setting = (value, previousDefault, nextDefault) =>
    storedVersion === 1 && Number(value) === previousDefault ? nextDefault : value;
  const settings = {
    localToastEnabled: all.localToastEnabled !== false,
    localToastPosition: ["top-right", "top-left", "bottom-right", "bottom-left"].includes(all.localToastPosition)
      ? all.localToastPosition : DEFAULT_SETTINGS.localToastPosition,
    localToastDuration: clampNumber(storedToastDuration, 2000, 300000, DEFAULT_SETTINGS.localToastDuration),
    pollIntervalMinutes: clampNumber(
      migratedV1Setting(all.pollIntervalMinutes, VERSION_1_DEFAULT_SETTINGS.pollIntervalMinutes, DEFAULT_SETTINGS.pollIntervalMinutes),
      1, 1440, DEFAULT_SETTINGS.pollIntervalMinutes
    ),
    maxPostsPerFeed: clampNumber(
      migratedV1Setting(all.maxPostsPerFeed, VERSION_1_DEFAULT_SETTINGS.maxPostsPerFeed, DEFAULT_SETTINGS.maxPostsPerFeed),
      25, 500, DEFAULT_SETTINGS.maxPostsPerFeed
    )
  };
  const standaloneState = all[STATE_KEY];
  const state = standaloneState && Array.isArray(standaloneState.feeds) && Array.isArray(standaloneState.posts)
    ? standaloneState : emptyState();
  state.feeds = state.feeds.map(feed => ({ ...feed, toastEnabled: feed.toastEnabled !== false }));
  rebalanceFeedSchedules(state, Date.now(), settings.pollIntervalMinutes);
  try { if (chrome.storage.sync?.clear) await chrome.storage.sync.clear(); } catch (_error) {}
  try { if (chrome.storage.session?.clear) await chrome.storage.session.clear(); } catch (_error) {}
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    ...settings,
    [STATE_KEY]: state,
    [TOAST_STATE_KEY]: emptyToastState(),
    [SCHEDULE_INTERVAL_KEY]: settings.pollIntervalMinutes,
    newsFeedPulseStandaloneVersion: STANDALONE_VERSION
  });
  await trimPosts(state);
  await chrome.storage.local.set({ [STATE_KEY]: state });
  await deleteLegacyDatabases();
}

async function clearToolbarBadge() {
  try { await chrome.action.setBadgeText({ text: "" }); } catch (_error) {}
}

const initialization = migrateLegacyData().then(clearToolbarBadge);

function runLocked(task) {
  const run = mutationQueue.then(task, task);
  mutationQueue = run.catch(() => undefined);
  return run;
}

function runToastLocked(task) {
  const run = toastMutationQueue.then(task, task);
  toastMutationQueue = run.catch(() => undefined);
  return run;
}

function runAlarmLocked(task) {
  const run = alarmMutationQueue.then(task, task);
  alarmMutationQueue = run.catch(() => undefined);
  return run;
}

async function getState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const value = stored[STATE_KEY];
  if (!value || !Array.isArray(value.feeds) || !Array.isArray(value.posts)) return emptyState();
  return {
    version: 1,
    feeds: value.feeds.map(feed => ({ ...feed, toastEnabled: feed.toastEnabled !== false })),
    posts: value.posts
  };
}

async function saveState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
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

function rebalanceFeedSchedules(state, now, intervalMinutes) {
  const feeds = [...state.feeds].sort((left, right) =>
    Number(left.addedAt || 0) - Number(right.addedAt || 0) || String(left.id).localeCompare(String(right.id)));
  if (!feeds.length) return;
  const interval = Math.max(1, Math.round(intervalMinutes));
  for (let index = 0; index < feeds.length; index += 1) {
    const slot = Math.max(1, Math.ceil(((index + 1) * interval) / feeds.length));
    feeds[index].nextRefreshAt = now + slot * MINUTE_MS;
  }
}

function chooseNextRefreshAt(feeds, now, intervalMinutes) {
  const interval = Math.max(1, Math.round(intervalMinutes));
  if (!feeds.length) return now + interval * MINUTE_MS;
  const counts = Array(interval).fill(0);
  for (const feed of feeds) {
    const remaining = Number(feed.nextRefreshAt) - now;
    if (!Number.isFinite(remaining)) continue;
    const slot = Math.min(interval, Math.max(1, Math.ceil(remaining / MINUTE_MS)));
    counts[slot - 1] += 1;
  }
  let selected = 0;
  for (let index = 1; index < counts.length; index += 1) {
    if (counts[index] < counts[selected]) selected = index;
  }
  return now + (selected + 1) * MINUTE_MS;
}

function advanceRefreshAt(value, now, intervalMinutes) {
  const intervalMs = Math.max(1, Math.round(intervalMinutes)) * MINUTE_MS;
  let next = Number(value);
  if (!Number.isFinite(next)) next = now;
  do { next += intervalMs; } while (next <= now + SCHEDULE_GRACE_MS);
  return next;
}

function emptyToastState() {
  return { version: 1, queue: [], lease: null };
}

async function getToastState() {
  const stored = await chrome.storage.local.get(TOAST_STATE_KEY);
  const value = stored[TOAST_STATE_KEY];
  if (!value || !Array.isArray(value.queue)) return emptyToastState();
  return { version: 1, queue: value.queue, lease: value.lease || null };
}

async function saveToastState(state) {
  await chrome.storage.local.set({ [TOAST_STATE_KEY]: state });
}

function publicState(state) {
  const feeds = state.feeds.map(feed => {
    const {
      seenItemIds: _seenItemIds,
      seenItemKeys: _seenItemKeys,
      nextRefreshAt: _nextRefreshAt,
      skipOfflineCatchUp: _skipOfflineCatchUp,
      ...publicFeed
    } = feed;
    return { ...publicFeed, toastEnabled: feed.toastEnabled !== false };
  });
  const feedById = new Map(feeds.map(feed => [feed.id, feed]));
  const posts = state.posts.map(post => ({
    ...post,
    feedTitle: feedById.get(post.feedId)?.title || "RSS feed"
  })).sort((left, right) => (right.sortAt || 0) - (left.sortAt || 0));
  return { feeds, posts, unreadCount: posts.filter(post => !post.read).length };
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

async function addFeed(value, options = {}) {
  const requestedUrl = normalizeInput(value);
  const hasToastPreference = typeof options.toastEnabled === "boolean";
  const toastEnabled = hasToastPreference ? options.toastEnabled : true;
  let disabledExistingToast = false;
  const directExisting = await runLocked(async () => {
    const state = await getState();
    const existing = state.feeds.find(feed => feed.url === requestedUrl || feed.requestedUrl === requestedUrl);
    if (!existing) return null;
    if (hasToastPreference && existing.toastEnabled !== toastEnabled) {
      existing.toastEnabled = toastEnabled;
      disabledExistingToast = !toastEnabled;
      await saveState(state);
    }
    return { added: false, feed: existing, state: publicState(state) };
  });
  if (directExisting) {
    if (disabledExistingToast) await purgeToastQueueForFeed(directExisting.feed.id);
    return directExisting;
  }

  const loaded = await loadFeed(requestedUrl);
  const now = Date.now();
  const settings = await getSettings();
  const result = await runLocked(async () => {
    const state = await getState();
    const canonicalUrl = Core.normalizeHttpUrl(loaded.url) || requestedUrl;
    const existing = state.feeds.find(feed => feed.url === canonicalUrl || feed.requestedUrl === requestedUrl);
    if (existing) {
      if (hasToastPreference && existing.toastEnabled !== toastEnabled) {
        existing.toastEnabled = toastEnabled;
        disabledExistingToast = !toastEnabled;
        await saveState(state);
      }
      return { added: false, feed: existing, state: publicState(state) };
    }
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
      toastEnabled,
      nextRefreshAt: chooseNextRefreshAt(state.feeds, now, settings.pollIntervalMinutes),
      error: null
    };
    state.feeds.push(feed);
    const initialPosts = loaded.parsed.items.map(item => toStoredPost(item, feedId, now, true));
    state.posts.push(...initialPosts);
    await trimPosts(state);
    await saveState(state);
    return { added: true, feed, importedPosts: initialPosts.length, state: publicState(state) };
  });
  if (disabledExistingToast) await purgeToastQueueForFeed(result.feed.id);
  return result;
}

async function followDefaultFeeds(initialize = false) {
  if (initialize) await chrome.storage.local.set({ [DEFAULT_FEEDS_PENDING_KEY]: DEFAULT_FEED_URLS });
  const stored = await chrome.storage.local.get({ [DEFAULT_FEEDS_PENDING_KEY]: [] });
  const pending = Array.isArray(stored[DEFAULT_FEEDS_PENDING_KEY]) ? stored[DEFAULT_FEEDS_PENDING_KEY] : [];
  if (!pending.length) return;
  const results = await Promise.allSettled(pending.map(url => addFeed(url)));
  const failed = pending.filter((_url, index) => results[index].status === "rejected");
  await chrome.storage.local.set({ [DEFAULT_FEEDS_PENDING_KEY]: failed });
}

async function setFeedToast(feedId, enabled) {
  if (typeof feedId !== "string" || !feedId) throw userError("INVALID_FEED", "A feed must be selected.");
  if (typeof enabled !== "boolean") throw userError("INVALID_SETTING", "The feed notification setting must be true or false.");
  const publicValue = await runLocked(async () => {
    const state = await getState();
    const feed = state.feeds.find(value => value.id === feedId);
    if (!feed) throw userError("FEED_NOT_FOUND", "That feed is no longer subscribed.");
    feed.toastEnabled = enabled;
    await saveState(state);
    return publicState(state);
  });
  if (!enabled) await purgeToastQueueForFeed(feedId);
  return publicValue;
}

async function exportFeeds() {
  const state = await getState();
  return {
    format: "news-feed-pulse-feed-list",
    version: 1,
    exportedAt: new Date().toISOString(),
    feeds: state.feeds.map(feed => ({
      url: feed.url,
      title: feed.title || "RSS feed",
      toastEnabled: feed.toastEnabled !== false
    }))
  };
}

function validateImportedFeed(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw userError("INVALID_IMPORT_ENTRY", `Feed entry ${index + 1} is not an object.`);
  }
  if (typeof raw.url !== "string" || raw.url.length > 4096) {
    throw userError("INVALID_IMPORT_URL", `Feed entry ${index + 1} has an invalid URL.`);
  }
  const url = normalizeInput(raw.url);
  const parsed = new URL(url);
  if (parsed.username || parsed.password) {
    throw userError("URL_CREDENTIALS", `Feed entry ${index + 1} contains credentials in its URL.`);
  }
  const hasToastPreference = Object.prototype.hasOwnProperty.call(raw, "toastEnabled");
  if (hasToastPreference && typeof raw.toastEnabled !== "boolean") {
    throw userError("INVALID_IMPORT_SETTING", `Feed entry ${index + 1} has an invalid toast setting.`);
  }
  return { url, toastEnabled: hasToastPreference ? raw.toastEnabled : true };
}

async function importFeeds(documentValue) {
  let importSize = Infinity;
  try { importSize = new TextEncoder().encode(JSON.stringify(documentValue)).byteLength; } catch (_error) {}
  if (importSize > MAX_IMPORT_DOCUMENT_BYTES) {
    throw userError("IMPORT_TOO_LARGE", "A feed-list import cannot be larger than 1 MiB.");
  }
  if (!documentValue || typeof documentValue !== "object" || Array.isArray(documentValue)
    || documentValue.format !== "news-feed-pulse-feed-list" || documentValue.version !== 1
    || !Array.isArray(documentValue.feeds)) {
    throw userError("INVALID_IMPORT", "Choose a News Feed Pulse feed-list JSON file.");
  }
  if (documentValue.feeds.length > 500) {
    throw userError("IMPORT_TOO_LARGE", "A feed-list import can contain at most 500 feeds.");
  }

  const entries = [];
  const failures = [];
  const seen = new Set();
  let existing = 0;
  for (let index = 0; index < documentValue.feeds.length; index += 1) {
    try {
      const entry = validateImportedFeed(documentValue.feeds[index], index);
      if (seen.has(entry.url)) {
        existing += 1;
        continue;
      }
      seen.add(entry.url);
      entries.push(entry);
    } catch (error) {
      failures.push({ index, message: error.message || String(error) });
    }
  }

  let added = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor];
      cursor += 1;
      try {
        const result = await addFeed(entry.url, { toastEnabled: entry.toastEnabled });
        if (result.added) added += 1;
        else existing += 1;
      } catch (error) {
        failures.push({ url: entry.url, message: error.message || String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
  await scheduleNextPoll();
  return {
    added,
    existing,
    failed: failures.length,
    failures: failures.slice(0, 20),
    state: publicState(await getState())
  };
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

async function refreshFeed(feedId, options = {}) {
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
        delete storedFeed.skipOfflineCatchUp;
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
    const unseenItems = loaded.parsed.items.filter(item => !knownKeys.has(itemKey(item)));
    const discardUnseen = options.discardUnseen || storedFeed.skipOfflineCatchUp === true;
    const newPosts = discardUnseen ? [] : unseenItems.map(item => toStoredPost(item, feedId, now, false));
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
    delete storedFeed.skipOfflineCatchUp;
    await trimPosts(state);
    await saveState(state);
    return { newPosts, feed: { ...storedFeed } };
  });

  return result;
}

async function refreshFeeds(feedIds, notify = true, options = {}) {
  const results = new Array(feedIds.length);
  let cursor = 0;
  async function worker() {
    while (cursor < feedIds.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await refreshFeed(feedIds[index], options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, feedIds.length) }, () => worker()));
  if (notify) await enqueueRefreshNotifications(results);
  return { results, state: publicState(await getState()) };
}

async function refreshAll(notify = true, options = {}) {
  const state = await getState();
  return refreshFeeds(state.feeds.map(feed => feed.id), notify, options);
}

async function initializeBrowserSession() {
  const session = chrome.storage.session;
  if (!session?.get || !session?.set) return false;
  const stored = await session.get(BROWSER_SESSION_KEY);
  if (stored[BROWSER_SESSION_KEY]) return false;
  await session.set({ [BROWSER_SESSION_KEY]: true });
  await saveToastState(emptyToastState());
  await runLocked(async () => {
    const state = await getState();
    for (const feed of state.feeds) feed.skipOfflineCatchUp = true;
    await saveState(state);
  });
  await refreshAll(false, { discardUnseen: true });
  await ensureFeedSchedules(true);
  return true;
}

async function enqueueRefreshNotifications(results) {
  const settings = await getSettings();
  if (!settings.localToastEnabled) return 0;
  const groups = results.filter(result => result?.feed?.toastEnabled !== false && result.newPosts?.length)
    .map(result => ({
      feed: result.feed,
      posts: [...result.newPosts]
        .sort((left, right) => Number(right.sortAt || 0) - Number(left.sortAt || 0))
        .slice(0, 2)
    }))
    .sort((left, right) => Number(right.posts[0]?.sortAt || 0) - Number(left.posts[0]?.sortAt || 0));
  const items = [];
  for (let round = 0; round < 2; round += 1) {
    for (const group of groups) {
      const post = group.posts[round];
      if (!post) continue;
      items.push({
        id: `${group.feed.id}|${post.id}`,
        feedId: group.feed.id,
        postId: post.id,
        title: post.title,
        message: group.feed.title || "New RSS item",
        link: post.link,
        sortAt: post.sortAt || Date.now(),
        createdAt: Date.now()
      });
    }
  }
  if (!items.length) return 0;
  await enqueueToastItems(items);
  await requestToastDispatch().catch(() => false);
  return items.length;
}

async function enqueueToastItems(items) {
  return runToastLocked(async () => {
    const state = await getToastState();
    const settings = await getSettings();
    const currentState = await getState();
    const enabledFeeds = new Set(currentState.feeds
      .filter(feed => feed.toastEnabled !== false)
      .map(feed => feed.id));
    const isEligible = item => !item.feedId || enabledFeeds.has(item.feedId);
    const leasedItem = state.lease ? state.queue.find(item => item.id === state.lease.itemId) : null;
    if (state.lease && !leasedItem) state.lease = null;
    const combined = new Map();
    for (const item of state.queue) {
      if (item?.id && item.id !== leasedItem?.id && isEligible(item)) combined.set(item.id, item);
    }
    if (settings.localToastEnabled) {
      for (const item of items) {
        if (item?.id && item.id !== leasedItem?.id && isEligible(item)) combined.set(item.id, item);
      }
    }

    const ungrouped = [];
    const byFeed = new Map();
    for (const item of combined.values()) {
      if (!item.feedId) {
        ungrouped.push(item);
        continue;
      }
      if (!byFeed.has(item.feedId)) byFeed.set(item.feedId, []);
      byFeed.get(item.feedId).push(item);
    }
    ungrouped.sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
    const groups = Array.from(byFeed, ([feedId, feedItems]) => {
      feedItems.sort((left, right) => Number(right.sortAt || 0) - Number(left.sortAt || 0));
      const capacity = leasedItem?.feedId === feedId ? 1 : 2;
      return { feedId, items: feedItems.slice(0, capacity) };
    }).sort((left, right) => Number(right.items[0]?.sortAt || 0) - Number(left.items[0]?.sortAt || 0));

    const fairOrder = [];
    for (let round = 0; round < 2; round += 1) {
      for (const group of groups) {
        const leasedOffset = leasedItem?.feedId === group.feedId ? 1 : 0;
        const item = group.items[round - leasedOffset];
        if (item) fairOrder.push(item);
      }
    }
    state.queue = [
      ...(leasedItem ? [leasedItem] : []),
      ...ungrouped,
      ...fairOrder
    ].slice(0, MAX_TOAST_QUEUE);
    await saveToastState(state);
    return state.queue.length;
  });
}

async function findActiveToastTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.find(tab => tab.id && !tab.discarded && tab.status !== "loading"
    && !loadingToastTabs.has(tab.id) && /^https?:/i.test(tab.url || "")) || null;
}

async function deliverToastToTab(tabId, data) {
  async function send() {
    return chrome.tabs.sendMessage(tabId, { type: "localToast:deliver", data });
  }
  try {
    const response = await send();
    if (response?.accepted === true) return true;
    if (response?.accepted === false) return false;
  } catch (_error) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["local-toast.js"] });
    const response = await send();
    return response?.accepted === true;
  } catch (_error) {
    return false;
  }
}

function requestToastDispatch() {
  const run = toastDispatchQueue.then(dispatchNextToast, dispatchNextToast);
  toastDispatchQueue = run.catch(() => undefined);
  return run;
}

async function dispatchNextToast() {
  const settings = await getSettings();
  if (!settings.localToastEnabled) return false;
  const tab = await findActiveToastTab();
  if (!tab) return false;
  const now = Date.now();
  let delivery = null;
  let accepted = false;
  await runToastLocked(async () => {
    const state = await getToastState();
    if (state.lease && Number(state.lease.expiresAt) > now) return;
    if (state.lease) state.lease = null;
    const item = state.queue[0];
    if (!item) {
      await saveToastState(state);
      return;
    }
    const deliveryId = `toast-${now}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    const expiresAt = now + settings.localToastDuration + TOAST_LEASE_GRACE_MS;
    state.lease = { deliveryId, itemId: item.id, tabId: tab.id, expiresAt };
    delivery = {
      ...item,
      deliveryId,
      expiresAt,
      position: settings.localToastPosition,
      duration: settings.localToastDuration,
      iconUrl: chrome.runtime.getURL("extension-icons/icon48x48.png")
    };
    await saveToastState(state);
    try {
      await chrome.alarms.create(TOAST_RETRY_ALARM, { when: delivery.expiresAt });
      accepted = await deliverToastToTab(tab.id, delivery);
    } catch (_error) {
      accepted = false;
    }
    if (!accepted) {
      state.lease = null;
      await saveToastState(state);
      try { await chrome.alarms.clear(TOAST_RETRY_ALARM); } catch (_error) {}
    }
  });
  if (!delivery) return false;
  if (!accepted) {
    await chrome.alarms.create(TOAST_RETRY_ALARM, { when: Date.now() + TOAST_RETRY_DELAY_MS });
  }
  return accepted;
}

async function finishToastDelivery(deliveryId, tabId, consume, dispatchAfter = true) {
  let changed = false;
  await runToastLocked(async () => {
    const state = await getToastState();
    if (!state.lease || state.lease.deliveryId !== deliveryId
      || (tabId && state.lease.tabId !== tabId)) return;
    if (consume) state.queue = state.queue.filter(item => item.id !== state.lease.itemId);
    state.lease = null;
    changed = true;
    await saveToastState(state);
    try { await chrome.alarms.clear(TOAST_RETRY_ALARM); } catch (_error) {}
  });
  if (!changed) return false;
  if (dispatchAfter) await requestToastDispatch().catch(() => false);
  return true;
}

async function purgeToastQueueForFeed(feedId) {
  await runToastLocked(async () => {
    const state = await getToastState();
    const leasedItem = state.lease ? state.queue.find(item => item.id === state.lease.itemId) : null;
    let cancelledLease = null;
    if (leasedItem?.feedId === feedId) {
      cancelledLease = { ...state.lease };
      state.lease = null;
    }
    state.queue = state.queue.filter(item => item.feedId !== feedId);
    await saveToastState(state);
    if (cancelledLease) {
      try { await chrome.alarms.clear(TOAST_RETRY_ALARM); } catch (_error) {}
      await chrome.tabs.sendMessage(cancelledLease.tabId, {
        type: "localToast:cancel",
        data: { deliveryId: cancelledLease.deliveryId }
      }).catch(() => undefined);
    }
  });
  await requestToastDispatch().catch(() => false);
}

async function clearToastQueue() {
  await runToastLocked(async () => {
    const state = await getToastState();
    const cancelledLease = state.lease ? { ...state.lease } : null;
    await saveToastState(emptyToastState());
    try { await chrome.alarms.clear(TOAST_RETRY_ALARM); } catch (_error) {}
    if (cancelledLease) {
      await chrome.tabs.sendMessage(cancelledLease.tabId, {
        type: "localToast:cancel",
        data: { deliveryId: cancelledLease.deliveryId }
      }).catch(() => undefined);
    }
  });
}

async function removeFeed(feedId) {
  if (typeof feedId !== "string" || !feedId) throw userError("INVALID_FEED", "A feed must be selected.");
  const publicValue = await runLocked(async () => {
    const state = await getState();
    state.feeds = state.feeds.filter(feed => feed.id !== feedId);
    state.posts = state.posts.filter(post => post.feedId !== feedId);
    await saveState(state);
    return publicState(state);
  });
  await purgeToastQueueForFeed(feedId);
  await scheduleNextPoll();
  return publicValue;
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

async function ensureFeedSchedules(force = false) {
  const settings = await getSettings();
  const stored = await chrome.storage.local.get(SCHEDULE_INTERVAL_KEY);
  const intervalChanged = Number(stored[SCHEDULE_INTERVAL_KEY]) !== settings.pollIntervalMinutes;
  let changed = false;
  await runLocked(async () => {
    const state = await getState();
    const missingSchedule = state.feeds.some(feed => !Number.isFinite(Number(feed.nextRefreshAt)));
    if (!force && !intervalChanged && !missingSchedule) return;
    rebalanceFeedSchedules(state, Date.now(), settings.pollIntervalMinutes);
    await saveState(state);
    changed = true;
  });
  await chrome.storage.local.set({ [SCHEDULE_INTERVAL_KEY]: settings.pollIntervalMinutes });
  return changed;
}

async function scheduleNextPoll() {
  return runAlarmLocked(async () => {
    const state = await getState();
    const scheduledTimes = state.feeds.map(feed => Number(feed.nextRefreshAt)).filter(Number.isFinite);
    const existing = await chrome.alarms.get(POLL_ALARM);
    if (!scheduledTimes.length) {
      if (existing) await chrome.alarms.clear(POLL_ALARM);
      return null;
    }
    const when = Math.max(Date.now() + 1000, Math.min(...scheduledTimes));
    if (existing && !existing.periodInMinutes
      && Math.abs(Number(existing.scheduledTime) - when) <= 1000) return when;
    if (existing) await chrome.alarms.clear(POLL_ALARM);
    await chrome.alarms.create(POLL_ALARM, { when });
    return when;
  });
}

async function claimDueFeeds(now = Date.now()) {
  const settings = await getSettings();
  return runLocked(async () => {
    const state = await getState();
    let changed = false;
    if (state.feeds.some(feed => !Number.isFinite(Number(feed.nextRefreshAt)))) {
      rebalanceFeedSchedules(state, now, settings.pollIntervalMinutes);
      changed = true;
    }
    const due = state.feeds
      .filter(feed => Number(feed.nextRefreshAt) <= now + SCHEDULE_GRACE_MS)
      .sort((left, right) => Number(left.nextRefreshAt) - Number(right.nextRefreshAt));
    const perSlot = Math.max(1, Math.ceil(state.feeds.length / Math.max(1, settings.pollIntervalMinutes)));
    const claimed = due.slice(0, perSlot);
    const overflow = due.slice(perSlot);
    for (const feed of claimed) {
      feed.nextRefreshAt = advanceRefreshAt(feed.nextRefreshAt, now, settings.pollIntervalMinutes);
      changed = true;
    }
    for (let index = 0; index < overflow.length; index += 1) {
      const slot = Math.max(1, Math.ceil(((index + 1) * settings.pollIntervalMinutes) / overflow.length));
      overflow[index].nextRefreshAt = now + slot * MINUTE_MS;
      changed = true;
    }
    if (changed) await saveState(state);
    return claimed.map(feed => feed.id);
  });
}

async function runScheduledPoll() {
  if (scheduledPollRun) return scheduledPollRun;
  const run = (async () => {
    const feedIds = await claimDueFeeds();
    await scheduleNextPoll();
    try {
      if (!feedIds.length) return { results: [], state: publicState(await getState()) };
      return await refreshFeeds(feedIds, true);
    } finally {
      // A one-shot alarm can be consumed while a slow prior group is still running.
      // Recompute it after the network work so polling can never be stranded.
      await scheduleNextPoll();
    }
  })();
  scheduledPollRun = run;
  try {
    return await run;
  } finally {
    if (scheduledPollRun === run) scheduledPollRun = null;
  }
}

async function handleSettingsChanged() {
  const settings = await getSettings();
  await ensureFeedSchedules();
  await runLocked(async () => {
    const state = await getState();
    await trimPosts(state);
    await saveState(state);
  });
  if (settings.localToastEnabled) await requestToastDispatch().catch(() => false);
  else await clearToastQueue();
  await scheduleNextPoll();
  return settings;
}

async function retryExpiredToast() {
  let shouldDispatch = false;
  await runToastLocked(async () => {
    const state = await getToastState();
    const lease = state.lease;
    if (!lease) {
      shouldDispatch = true;
      return;
    }
    if (Number(lease.expiresAt) > Date.now() + 250) {
      await chrome.alarms.create(TOAST_RETRY_ALARM, { when: Number(lease.expiresAt) });
      return;
    }
    state.lease = null;
    await saveToastState(state);
    try { await chrome.alarms.clear(TOAST_RETRY_ALARM); } catch (_error) {}
    shouldDispatch = true;
  });
  if (!shouldDispatch) return false;
  return requestToastDispatch().catch(() => false);
}

async function releaseToastForTab(tabId, dispatchAfter = true) {
  const state = await getToastState();
  if (!state.lease || state.lease.tabId !== tabId) return false;
  return finishToastDelivery(state.lease.deliveryId, tabId, false, dispatchAfter);
}

async function queueTestToast() {
  const settings = await getSettings();
  if (!settings.localToastEnabled) {
    throw userError("TOAST_DISABLED", "Turn on in-page notifications before testing them.");
  }
  const tab = await findActiveToastTab();
  if (!tab) {
    throw userError("TOAST_UNAVAILABLE", "Open a standard HTTP or HTTPS webpage, then try the test again.");
  }
  const now = Date.now();
  const testId = `test-${now}-${Math.random().toString(36).slice(2)}`;
  await enqueueToastItems([{
    id: testId,
    feedId: null,
    postId: null,
    title: "Toast notifications are working",
    message: "This notification uses your selected display time.",
    link: null,
    sortAt: now,
    createdAt: now
  }]);
  await requestToastDispatch().catch(() => false);
  const toastState = await getToastState();
  const delivered = toastState.lease?.itemId === testId;
  return { delivered, queued: !delivered && toastState.queue.some(item => item.id === testId) };
}

async function handleMessage(message, sender) {
  await initialization;
  if (browserSessionReady) await browserSessionReady;
  const type = message?.type;
  const data = message?.data || {};
  switch (type) {
    case "state:get": return publicState(await getState());
    case "feeds:discover": return discoverFeeds(data.url, data.candidates);
    case "feeds:add": {
      const result = await addFeed(data.url);
      await scheduleNextPoll();
      return result;
    }
    case "feeds:remove": return removeFeed(data.feedId);
    case "feeds:setToast": return setFeedToast(data.feedId, data.enabled);
    case "feeds:export": return exportFeeds();
    case "feeds:import": return importFeeds(data.document);
    case "feeds:refresh": {
      if (!data.feedId) return refreshAll(true);
      const refreshed = await refreshFeeds([data.feedId], true);
      return { result: refreshed.results[0], state: refreshed.state };
    }
    case "posts:update": return updatePost(data.postId, data.patch || {});
    case "posts:markAllRead": return markAllRead(data.feedId);
    case "posts:open": return openPost(data.postId);
    case "page:active": return getActivePage();
    case "settings:changed": return handleSettingsChanged();
    case "toast:test": return queueTestToast();
    case "page:feeds": {
      if (sender.tab?.id) activePageFeeds.set(sender.tab.id, {
        pageUrl: Core.normalizeHttpUrl(data.pageUrl || sender.tab.url),
        candidates: dedupeCandidates(data.candidates || [])
      });
      return true;
    }
    case "localToast:ready": {
      await requestToastDispatch().catch(() => false);
      return true;
    }
    case "localToast:complete": {
      const completed = await finishToastDelivery(data.deliveryId, sender.tab?.id, true);
      if (!completed) await requestToastDispatch().catch(() => false);
      return completed;
    }
    case "localToast:defer": {
      const deferred = await finishToastDelivery(data.deliveryId, sender.tab?.id, false);
      if (!deferred) await requestToastDispatch().catch(() => false);
      return deferred;
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

chrome.runtime.onInstalled.addListener(details => {
  initialization.then(async () => {
    if (details?.reason === "install") await followDefaultFeeds(true);
    await ensureFeedSchedules();
    await scheduleNextPoll();
    await requestToastDispatch();
  }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  browserSessionReady.then(() => ensureFeedSchedules()).then(() => scheduleNextPoll())
    .then(() => requestToastDispatch()).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM) {
    initialization.then(() => browserSessionReady).then(() => runScheduledPoll())
      .catch(error => console.error("[News Feed Pulse] Scheduled refresh failed:", error));
  } else if (alarm.name === TOAST_RETRY_ALARM) {
    initialization.then(() => retryExpiredToast()).catch(() => undefined);
  }
});

chrome.tabs.onActivated?.addListener(() => requestToastDispatch().catch(() => undefined));
chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    loadingToastTabs.add(tabId);
    activePageFeeds.delete(tabId);
    releaseToastForTab(tabId, false).catch(() => undefined);
  } else if (changeInfo.status === "complete") {
    loadingToastTabs.delete(tabId);
    requestToastDispatch().catch(() => undefined);
  }
});
chrome.tabs.onRemoved.addListener(tabId => {
  loadingToastTabs.delete(tabId);
  activePageFeeds.delete(tabId);
  releaseToastForTab(tabId).catch(() => undefined);
});

browserSessionReady = initialization.then(() => followDefaultFeeds()).then(() => initializeBrowserSession());
browserSessionReady.then(() => ensureFeedSchedules()).then(() => scheduleNextPoll())
  .then(() => requestToastDispatch()).catch(() => undefined);
