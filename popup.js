"use strict";

try {
  if (localStorage.getItem("newsFeedPulseStandaloneCleared") !== "1") {
    localStorage.clear();
    localStorage.setItem("newsFeedPulseStandaloneCleared", "1");
  }
  sessionStorage.clear();
} catch (_error) {}

const ui = {
  settings: document.getElementById("settings-button"),
  refresh: document.getElementById("refresh-button"),
  add: document.getElementById("add-button"),
  headerStatus: document.getElementById("header-status"),
  readerView: document.getElementById("reader-view"),
  addView: document.getElementById("add-view"),
  back: document.getElementById("add-back-button"),
  feedFilter: document.getElementById("feed-filter"),
  removeFeed: document.getElementById("remove-feed-button"),
  markAll: document.getElementById("mark-all-button"),
  search: document.getElementById("search-input"),
  postList: document.getElementById("post-list"),
  readerMessage: document.getElementById("reader-message"),
  discoverForm: document.getElementById("discover-form"),
  feedUrl: document.getElementById("feed-url"),
  discoverButton: document.getElementById("discover-button"),
  discoveryStatus: document.getElementById("discovery-status"),
  discoveryActions: document.getElementById("discovery-actions"),
  resultCount: document.getElementById("result-count"),
  addAll: document.getElementById("add-all-button"),
  candidateList: document.getElementById("candidate-list"),
  postTemplate: document.getElementById("post-template"),
  candidateTemplate: document.getElementById("candidate-template")
};

let readerState = { feeds: [], posts: [], unreadCount: 0 };
let activePage = { url: "", title: "", candidates: [] };
let candidates = [];
let activeFilter = "all";

function request(type, data = {}) {
  return chrome.runtime.sendMessage({ type, data }).then(response => {
    if (!response?.ok) throw new Error(response?.error?.message || "The local RSS service did not respond.");
    return response.data;
  });
}

function setMessage(element, text, kind = "") {
  element.textContent = text || "";
  element.className = `message${kind ? ` ${kind}` : ""}`;
  element.hidden = !text;
}

function relativeTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return "";
  const seconds = Math.round((value - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return "now";
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (absolute < 2592000) return formatter.format(Math.round(seconds / 86400), "day");
  return new Date(value).toLocaleDateString();
}

function renderState() {
  const selectedFeed = ui.feedFilter.value;
  ui.feedFilter.replaceChildren(new Option("All feeds", ""));
  for (const feed of readerState.feeds) ui.feedFilter.append(new Option(feed.title, feed.id));
  if (readerState.feeds.some(feed => feed.id === selectedFeed)) ui.feedFilter.value = selectedFeed;
  ui.removeFeed.hidden = !ui.feedFilter.value;
  ui.headerStatus.textContent = readerState.unreadCount
    ? `${readerState.unreadCount} unread · ${readerState.feeds.length} feed${readerState.feeds.length === 1 ? "" : "s"}`
    : `${readerState.feeds.length} feed${readerState.feeds.length === 1 ? "" : "s"} · up to date`;
  renderPosts();
}

function renderPosts() {
  const query = ui.search.value.trim().toLowerCase();
  const feedId = ui.feedFilter.value;
  let posts = readerState.posts.filter(post => !feedId || post.feedId === feedId);
  if (activeFilter === "unread") posts = posts.filter(post => !post.read);
  if (activeFilter === "starred") posts = posts.filter(post => post.starred);
  if (query) posts = posts.filter(post => `${post.title} ${post.summary} ${post.feedTitle}`.toLowerCase().includes(query));
  ui.postList.replaceChildren();

  const selected = readerState.feeds.find(feed => feed.id === feedId);
  if (selected?.error) setMessage(ui.readerMessage, `${selected.title}: ${selected.error}`, "error");
  else setMessage(ui.readerMessage, "");

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    const description = document.createElement("span");
    if (!readerState.feeds.length) {
      title.textContent = "No feeds yet";
      description.textContent = "Use the + button to find a feed on the current page or paste a feed URL.";
    } else {
      title.textContent = "No matching posts";
      description.textContent = "Try another feed, filter, or search.";
    }
    empty.append(title, description);
    ui.postList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const post of posts) {
    const card = ui.postTemplate.content.firstElementChild.cloneNode(true);
    card.classList.toggle("unread", !post.read);
    card.dataset.postId = post.id;
    card.querySelector(".post-title").textContent = post.title || "Untitled item";
    const time = relativeTime(post.sortAt);
    card.querySelector(".post-meta").textContent = `${post.feedTitle}${time ? ` · ${time}` : ""}`;
    card.querySelector(".post-summary").textContent = post.summary || "";
    const open = card.querySelector(".post-open");
    open.disabled = !post.link;
    open.addEventListener("click", () => openPost(post.id));
    const star = card.querySelector(".star-button");
    star.textContent = post.starred ? "★" : "☆";
    star.classList.toggle("starred", Boolean(post.starred));
    star.setAttribute("aria-label", post.starred ? "Unstar post" : "Star post");
    star.addEventListener("click", () => toggleStar(post.id, !post.starred));
    fragment.append(card);
  }
  ui.postList.append(fragment);
}

async function openPost(postId) {
  try {
    await request("posts:open", { postId });
    const post = readerState.posts.find(value => value.id === postId);
    if (post && !post.read) {
      post.read = true;
      readerState.unreadCount = Math.max(0, readerState.unreadCount - 1);
      renderState();
    }
  } catch (error) { setMessage(ui.readerMessage, error.message, "error"); }
}

async function toggleStar(postId, starred) {
  try {
    readerState = await request("posts:update", { postId, patch: { starred } });
    renderState();
  } catch (error) { setMessage(ui.readerMessage, error.message, "error"); }
}

function closeAddView(restoreFocus = true) {
  ui.addView.hidden = true;
  ui.add.classList.remove("active");
  ui.add.setAttribute("aria-expanded", "false");
  if (restoreFocus) ui.add.focus();
}

let addViewInitialized = false;
let activePageLoaded = false;

function initializeAddView() {
  if (addViewInitialized || !activePageLoaded) return;
  addViewInitialized = true;
  if (ui.feedUrl.value.trim()) return;
  candidates = [];
  renderCandidates();
  setMessage(ui.discoveryStatus, "");
  const preferred = activePage.candidates?.[0]?.url || activePage.url || "";
  ui.feedUrl.value = preferred;
  if (activePage.url) discover(activePage.url, activePage.candidates);
}

function showAddView() {
  ui.addView.hidden = false;
  ui.add.classList.add("active");
  ui.add.setAttribute("aria-expanded", "true");
  initializeAddView();
  ui.feedUrl.focus();
  ui.feedUrl.select();
}

async function discover(value, pageCandidates = []) {
  const url = String(value || ui.feedUrl.value).trim();
  if (!url) return;
  ui.discoverButton.disabled = true;
  ui.discoverButton.textContent = "Finding…";
  setMessage(ui.discoveryStatus, "Checking the page and validating feed links…");
  candidates = [];
  renderCandidates();
  try {
    const result = await request("feeds:discover", { url, candidates: pageCandidates });
    candidates = result.candidates || [];
    setMessage(ui.discoveryStatus, candidates.length === 1
      ? "One working feed found."
      : `${candidates.length} working feeds found on this page.`, "success");
    renderCandidates();
  } catch (error) {
    setMessage(ui.discoveryStatus, error.message, "error");
  } finally {
    ui.discoverButton.disabled = false;
    ui.discoverButton.textContent = "Find feeds";
  }
}

function renderCandidates() {
  ui.candidateList.replaceChildren();
  ui.discoveryActions.hidden = !candidates.length;
  ui.resultCount.textContent = candidates.length ? `${candidates.length} feed${candidates.length === 1 ? "" : "s"}` : "";
  ui.addAll.hidden = candidates.length < 2;
  const storedUrls = new Set(readerState.feeds.flatMap(feed => [feed.url, feed.requestedUrl].filter(Boolean)));
  for (const candidate of candidates) {
    const card = ui.candidateTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".candidate-title").textContent = candidate.title || "RSS feed";
    card.querySelector(".candidate-url").textContent = candidate.url;
    card.querySelector(".candidate-meta").textContent = `${String(candidate.format || "feed").toUpperCase()} · ${candidate.itemCount ?? 0} recent items`;
    const button = card.querySelector(".candidate-add");
    if (storedUrls.has(candidate.url)) {
      button.textContent = "Added";
      button.disabled = true;
      button.classList.add("added");
    } else {
      button.addEventListener("click", () => addCandidate(candidate, button));
    }
    ui.candidateList.append(card);
  }
}

async function addCandidate(candidate, button) {
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const result = await request("feeds:add", { url: candidate.url });
    readerState = result.state;
    button.textContent = result.added ? "Added" : "Already added";
    button.classList.add("added");
    setMessage(ui.discoveryStatus, result.added
      ? `${result.feed.title} added with ${result.importedPosts} recent posts.`
      : `${result.feed.title} is already in your feeds.`, "success");
    renderState();
    renderCandidates();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Add";
    setMessage(ui.discoveryStatus, error.message, "error");
  }
}

async function addAllCandidates() {
  const existing = new Set(readerState.feeds.flatMap(feed => [feed.url, feed.requestedUrl].filter(Boolean)));
  const pending = candidates.filter(candidate => !existing.has(candidate.url));
  if (!pending.length) return;
  ui.addAll.disabled = true;
  let added = 0;
  for (const candidate of pending) {
    setMessage(ui.discoveryStatus, `Adding ${added + 1} of ${pending.length}…`);
    try {
      const result = await request("feeds:add", { url: candidate.url });
      readerState = result.state;
      if (result.added) added += 1;
    } catch (_error) {}
    renderCandidates();
  }
  ui.addAll.disabled = false;
  setMessage(ui.discoveryStatus, `${added} feed${added === 1 ? "" : "s"} added.`, added ? "success" : "error");
  renderState();
}

async function refreshFeeds() {
  ui.refresh.disabled = true;
  ui.refresh.textContent = "…";
  setMessage(ui.readerMessage, "Refreshing feeds…");
  try {
    const response = await request("feeds:refresh", { feedId: ui.feedFilter.value || null });
    readerState = response.state;
    setMessage(ui.readerMessage, "Feeds refreshed.", "success");
    renderState();
  } catch (error) {
    setMessage(ui.readerMessage, error.message, "error");
  } finally {
    ui.refresh.disabled = false;
    ui.refresh.textContent = "↻";
  }
}

ui.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
ui.add.addEventListener("click", () => ui.addView.hidden ? showAddView() : closeAddView());
ui.back.addEventListener("click", () => closeAddView());
ui.refresh.addEventListener("click", refreshFeeds);
ui.search.addEventListener("input", renderPosts);
ui.feedFilter.addEventListener("change", () => { ui.removeFeed.hidden = !ui.feedFilter.value; renderPosts(); });
document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter").forEach(value => value.classList.toggle("active", value === button));
  renderPosts();
}));
ui.discoverForm.addEventListener("submit", event => { event.preventDefault(); discover(ui.feedUrl.value); });
ui.addAll.addEventListener("click", addAllCandidates);
ui.markAll.addEventListener("click", async () => {
  try { readerState = await request("posts:markAllRead", { feedId: ui.feedFilter.value || null }); renderState(); }
  catch (error) { setMessage(ui.readerMessage, error.message, "error"); }
});
ui.removeFeed.addEventListener("click", async () => {
  const feed = readerState.feeds.find(value => value.id === ui.feedFilter.value);
  if (!feed || !confirm(`Remove “${feed.title}” and its saved posts?`)) return;
  try {
    readerState = await request("feeds:remove", { feedId: feed.id });
    ui.feedFilter.value = "";
    renderState();
  } catch (error) { setMessage(ui.readerMessage, error.message, "error"); }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !ui.addView.hidden) closeAddView();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.newsFeedPulseStateV1) request("state:get").then(value => { readerState = value; renderState(); }).catch(() => undefined);
});

Promise.all([request("state:get"), request("page:active")])
  .then(([state, page]) => {
    readerState = state;
    activePage = page;
    activePageLoaded = true;
    renderState();
    if (!ui.addView.hidden) initializeAddView();
  })
  .catch(error => {
    setMessage(ui.readerMessage, `Could not start the local reader: ${error.message}`, "error");
    renderState();
  });
