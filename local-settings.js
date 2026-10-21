"use strict";

try {
  if (localStorage.getItem("newsFeedPulseStandaloneCleared") !== "1") {
    localStorage.clear();
    localStorage.setItem("newsFeedPulseStandaloneCleared", "1");
  }
  sessionStorage.clear();
} catch (_error) {}

const defaults = {
  localToastEnabled: true,
  localToastPosition: "top-right",
  localToastDuration: 8000,
  pollIntervalMinutes: 15,
  maxPostsPerFeed: 150
};
const enabledInput = document.getElementById("toast-enabled");
const positionInput = document.getElementById("toast-position");
const durationInput = document.getElementById("toast-duration");
const pollInput = document.getElementById("poll-interval");
const maxPostsInput = document.getElementById("max-posts");
const settingsStatus = document.getElementById("settings-status");
const feedStatus = document.getElementById("feed-status");
const feedResults = document.getElementById("feed-results");
const savedFeeds = document.getElementById("saved-feeds");
let state = { feeds: [], posts: [], unreadCount: 0 };
let currentCandidates = [];

function request(type, data = {}) {
  return chrome.runtime.sendMessage({ type, data }).then(response => {
    if (!response?.ok) throw new Error(response?.error?.message || "The local RSS service did not respond.");
    return response.data;
  });
}

function status(element, message, error = false) {
  element.textContent = message || "";
  element.className = error ? "error" : "";
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(defaults);
  enabledInput.checked = settings.localToastEnabled;
  positionInput.value = settings.localToastPosition;
  durationInput.value = String(settings.localToastDuration);
  pollInput.value = String(settings.pollIntervalMinutes);
  maxPostsInput.value = String(settings.maxPostsPerFeed);
  state = await request("state:get");
  renderSavedFeeds();
}

async function saveSettings() {
  await chrome.storage.local.set({
    localToastEnabled: enabledInput.checked,
    localToastPosition: positionInput.value,
    localToastDuration: Number(durationInput.value),
    pollIntervalMinutes: Number(pollInput.value),
    maxPostsPerFeed: Number(maxPostsInput.value)
  });
  await request("settings:changed");
  status(settingsStatus, "Settings saved locally.");
}

function renderSavedFeeds() {
  savedFeeds.replaceChildren();
  if (!state.feeds.length) {
    const empty = document.createElement("p");
    empty.textContent = "No feeds have been added yet.";
    savedFeeds.append(empty);
    return;
  }
  for (const feed of state.feeds) {
    const row = document.createElement("div");
    row.className = "saved-feed";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = feed.title;
    const url = document.createElement("span");
    url.textContent = feed.url;
    details.append(title, url);
    if (feed.error) {
      const error = document.createElement("small");
      error.className = "error-text";
      error.textContent = feed.error;
      details.append(error);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove “${feed.title}” and its saved posts?`)) return;
      try { state = await request("feeds:remove", { feedId: feed.id }); renderSavedFeeds(); renderResults(currentCandidates); }
      catch (error) { status(feedStatus, error.message, true); }
    });
    row.append(details, remove);
    savedFeeds.append(row);
  }
}

function renderResults(candidates) {
  currentCandidates = candidates;
  feedResults.replaceChildren();
  const existing = new Set(state.feeds.flatMap(feed => [feed.url, feed.requestedUrl].filter(Boolean)));
  for (const candidate of candidates) {
    const row = document.createElement("div");
    row.className = "feed-result";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = candidate.title || "RSS feed";
    const url = document.createElement("span");
    url.textContent = candidate.url;
    details.append(title, url);
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = existing.has(candidate.url) ? "Added" : "Add";
    add.disabled = existing.has(candidate.url);
    add.addEventListener("click", async () => {
      add.disabled = true;
      add.textContent = "Adding…";
      try {
        const result = await request("feeds:add", { url: candidate.url });
        state = result.state;
        status(feedStatus, `${result.feed.title} ${result.added ? "was added" : "is already subscribed"}.`);
        renderSavedFeeds();
        renderResults(candidates);
      } catch (error) {
        add.disabled = false;
        add.textContent = "Add";
        status(feedStatus, error.message, true);
      }
    });
    row.append(details, add);
    feedResults.append(row);
  }
}

document.getElementById("save-settings").addEventListener("click", async () => {
  try { await saveSettings(); }
  catch (error) { status(settingsStatus, error.message || String(error), true); }
});

document.getElementById("test-toast").addEventListener("click", async () => {
  try { await saveSettings(); await request("toast:test"); status(settingsStatus, "A test toast was sent to the active webpage."); }
  catch (error) { status(settingsStatus, error.message || String(error), true); }
});

document.getElementById("add-feed-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.getElementById("feed-url");
  const button = document.getElementById("find-feeds");
  button.disabled = true;
  status(feedStatus, "Checking the page and validating feed links…");
  feedResults.replaceChildren();
  try {
    const result = await request("feeds:discover", { url: input.value.trim() });
    status(feedStatus, `${result.candidates.length} working feed${result.candidates.length === 1 ? "" : "s"} found.`);
    renderResults(result.candidates);
  } catch (error) { status(feedStatus, error.message || String(error), true); }
  finally { button.disabled = false; }
});

document.getElementById("refresh-feeds").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    const result = await request("feeds:refresh");
    state = result.state;
    renderSavedFeeds();
    status(feedStatus, "Feeds refreshed.");
  } catch (error) { status(feedStatus, error.message || String(error), true); }
  finally { button.disabled = false; button.textContent = "Refresh all"; }
});

loadSettings().catch(error => status(settingsStatus, error.message || String(error), true));
