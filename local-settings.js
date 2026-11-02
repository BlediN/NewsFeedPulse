"use strict";

try {
  if (localStorage.getItem("newsFeedPulseStandaloneCleared") !== "1") {
    localStorage.clear();
    localStorage.setItem("newsFeedPulseStandaloneCleared", "1");
  }
  sessionStorage.clear();
} catch (_error) {}

const defaults = {
  localToastScheduleEnabled: false,
  localToastSchedule: {
    0: { enabled: true, start: "07:30", end: "14:30" },
    1: { enabled: false, start: "00:00", end: "06:30" },
    2: { enabled: false, start: "00:00", end: "06:30" },
    3: { enabled: false, start: "00:00", end: "06:30" },
    4: { enabled: true, start: "00:00", end: "06:30" },
    5: { enabled: true, start: "00:00", end: "06:30" },
    6: { enabled: true, start: "07:30", end: "14:30" },
  },
  localToastPosition: "top-right",
  localToastDuration: 4000,
  localToastPostsPerFeed: 2,
  pollIntervalMinutes: 5,
  maxPostsPerFeed: 20,
};
const scheduleInput = document.getElementById("toast-schedule-enabled");
const positionInput = document.getElementById("toast-position");
const durationInput = document.getElementById("toast-duration");
const postsPerToastInput = document.getElementById("toast-posts-per-feed");
const pollInput = document.getElementById("poll-interval");
const maxPostsInput = document.getElementById("max-posts");
const settingsStatus = document.getElementById("settings-status");
const feedStatus = document.getElementById("feed-status");
const feedResults = document.getElementById("feed-results");
const savedFeeds = document.getElementById("saved-feeds");
const feedListStatus = document.getElementById("feed-list-status");
const importFeedsButton = document.getElementById("import-feeds");
const importFeedsFile = document.getElementById("import-feeds-file");
const exportFeedsButton = document.getElementById("export-feeds");
const suggestedSources = document.getElementById("suggested-sources");
const suggestedSourcesStatus = document.getElementById(
  "suggested-sources-status",
);
const suggestedSearch = document.getElementById("suggested-search");
const suggestedCount = document.getElementById("suggested-count");
const SCHEDULE_DAY_IDS = [1, 2, 3, 4, 5, 6, 0];
const MAX_IMPORT_BYTES = 1024 * 1024;
const SOURCE_CATEGORIES = globalThis.NewsFeedPulseSourceCategories || [];
let state = { feeds: [], posts: [], unreadCount: 0 };
let currentCandidates = [];

function request(type, data = {}) {
  return chrome.runtime.sendMessage({ type, data }).then((response) => {
    if (!response?.ok)
      throw new Error(
        response?.error?.message || "The local RSS service did not respond.",
      );
    return response.data;
  });
}

function status(element, message, error = false) {
  element.textContent = message || "";
  element.className = error ? "error" : "";
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(defaults);
  scheduleInput.checked = settings.localToastScheduleEnabled === true;
  const weeklySchedule =
    settings.localToastSchedule || defaults.localToastSchedule;
  for (const day of SCHEDULE_DAY_IDS) {
    const config = weeklySchedule[day] || defaults.localToastSchedule[day];
    document.getElementById(`schedule-day-${day}-enabled`).checked =
      config.enabled === true;
    document.getElementById(`schedule-day-${day}-start`).value =
      config.start || defaults.localToastSchedule[day].start;
    document.getElementById(`schedule-day-${day}-end`).value =
      config.end || defaults.localToastSchedule[day].end;
  }
  positionInput.value = settings.localToastPosition;
  durationInput.value = String(settings.localToastDuration);
  postsPerToastInput.value = String(settings.localToastPostsPerFeed);
  pollInput.value = String(settings.pollIntervalMinutes);
  maxPostsInput.value = String(settings.maxPostsPerFeed);
  state = await request("state:get");
  renderSavedFeeds();
  renderSuggestedSources();
}

function readWeeklySchedule() {
  const schedule = {};
  for (const day of SCHEDULE_DAY_IDS) {
    schedule[day] = {
      enabled: document.getElementById(`schedule-day-${day}-enabled`).checked,
      start: document.getElementById(`schedule-day-${day}-start`).value,
      end: document.getElementById(`schedule-day-${day}-end`).value,
    };
    if (
      schedule[day].enabled &&
      (!schedule[day].start ||
        !schedule[day].end ||
        schedule[day].end <= schedule[day].start)
    ) {
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      throw new Error(
        `${dayNames[day]}: end time must be later than start time.`,
      );
    }
  }
  return schedule;
}

async function saveSettings() {
  const weeklySchedule = readWeeklySchedule();
  const previousSettings = await chrome.storage.local.get({
    localToastScheduleEnabled: false,
    localToastSchedule: defaults.localToastSchedule,
  });
  const scheduleSignature = (schedule) =>
    JSON.stringify(
      SCHEDULE_DAY_IDS.map((day) => {
        const entry = schedule?.[day] || defaults.localToastSchedule[day];
        return [day, entry.enabled === true, entry.start, entry.end];
      }),
    );
  const scheduleChanged =
    previousSettings.localToastScheduleEnabled !== scheduleInput.checked ||
    scheduleSignature(previousSettings.localToastSchedule) !==
      scheduleSignature(weeklySchedule);
  await chrome.storage.local.set({
    localToastScheduleEnabled: scheduleInput.checked,
    localToastSchedule: weeklySchedule,
    localToastPosition: positionInput.value,
    localToastDuration: Number(durationInput.value),
    localToastPostsPerFeed: Number(postsPerToastInput.value),
    pollIntervalMinutes: Number(pollInput.value),
    maxPostsPerFeed: Number(maxPostsInput.value),
  });
  await request("settings:changed", { scheduleChanged });
  status(settingsStatus, "Settings saved locally.");
}

function renderSavedFeeds() {
  savedFeeds.replaceChildren();
  exportFeedsButton.disabled = !state.feeds.length;
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
    const actions = document.createElement("div");
    actions.className = "feed-actions";
    const toastLabel = document.createElement("label");
    toastLabel.className = "feed-toast-control";
    const toastToggle = document.createElement("input");
    toastToggle.type = "checkbox";
    toastToggle.checked = feed.toastEnabled !== false;
    toastToggle.setAttribute(
      "aria-label",
      `Show toast notifications for ${feed.title}`,
    );
    const toastText = document.createElement("span");
    toastText.textContent = "Toasts";
    toastLabel.append(toastToggle, toastText);
    toastToggle.addEventListener("change", async () => {
      const enabled = toastToggle.checked;
      toastToggle.disabled = true;
      try {
        state = await request("feeds:setToast", { feedId: feed.id, enabled });
        renderSavedFeeds();
        status(
          feedListStatus,
          `Toast notifications ${enabled ? "enabled" : "disabled"} for ${feed.title}.`,
        );
      } catch (error) {
        toastToggle.checked = !enabled;
        toastToggle.disabled = false;
        status(feedListStatus, error.message || String(error), true);
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove “${feed.title}” and its saved posts?`)) return;
      try {
        state = await request("feeds:remove", { feedId: feed.id });
        renderSavedFeeds();
        renderSuggestedSources();
        renderResults(currentCandidates);
        status(feedListStatus, `${feed.title} was removed.`);
      } catch (error) {
        status(feedListStatus, error.message, true);
      }
    });
    actions.append(toastLabel, remove);
    row.append(details, actions);
    savedFeeds.append(row);
  }
}

function renderSuggestedSources() {
  suggestedSources.replaceChildren();
  const followed = new Set(
    state.feeds.flatMap((feed) =>
      [feed.url, feed.requestedUrl].filter(Boolean),
    ),
  );
  const catalogUrls = new Set(
    SOURCE_CATEGORIES.flatMap((category) =>
      category.sources.map((source) => source.url),
    ),
  );
  const otherFollowed = state.feeds.filter(
    (feed) => !catalogUrls.has(feed.url) && !catalogUrls.has(feed.requestedUrl),
  );
  const categories = otherFollowed.length
    ? [
        {
          title: "Your followed sources",
          sources: otherFollowed.map((feed) => ({
            title: feed.title,
            description: "Already in your subscriptions",
            url: feed.requestedUrl || feed.url,
          })),
        },
        ...SOURCE_CATEGORIES,
      ]
    : SOURCE_CATEGORIES;
  const query = (suggestedSearch?.value || "").trim().toLowerCase();
  let visibleSourceCount = 0;
  let visibleCategoryCount = 0;

  for (const category of categories) {
    const matchingSources = category.sources.filter((source) => {
      if (!query) return true;
      return [
        category.title,
        source.title,
        source.description,
        source.url,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
    });
    if (!matchingSources.length) continue;
    visibleCategoryCount += 1;
    visibleSourceCount += matchingSources.length;

    const group = document.createElement("section");
    group.className = "source-group";
    const heading = document.createElement("div");
    heading.className = "source-group-heading";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = category.title;
    const categoryCount = document.createElement("span");
    categoryCount.className = "source-category-count";
    categoryCount.textContent = `${matchingSources.length} ${matchingSources.length === 1 ? "source" : "sources"}`;
    titleWrap.append(title, categoryCount);
    heading.append(titleWrap);

    const list = document.createElement("ul");
    list.className = "source-list";
    for (const source of matchingSources) {
      const item = document.createElement("li");
      item.className = "source-item";
      const details = document.createElement("div");
      details.className = "source-details";
      const sourceTitle = document.createElement("strong");
      sourceTitle.textContent = source.title;
      const description = document.createElement("small");
      description.textContent = source.description;
      const domain = document.createElement("span");
      domain.className = "source-domain";
      try {
        domain.textContent = new URL(source.url).hostname.replace(/^www\./, "");
      } catch (_error) {
        domain.textContent = source.url;
      }
      details.append(sourceTitle, description, domain);

      const follow = document.createElement("button");
      follow.type = "button";
      const isFollowed = followed.has(source.url);
      follow.className = isFollowed
        ? "source-follow is-following"
        : "source-follow";
      follow.textContent = isFollowed ? "Following" : "Follow";
      follow.disabled = isFollowed;
      follow.addEventListener("click", async () => {
        follow.disabled = true;
        follow.textContent = "Adding…";
        status(suggestedSourcesStatus, `Checking ${source.title}…`);
        try {
          const result = await request("feeds:add", { url: source.url });
          state = result.state;
          renderSavedFeeds();
          renderSuggestedSources();
          renderResults(currentCandidates);
          status(
            suggestedSourcesStatus,
            `${result.feed.title} ${result.added ? "is now followed" : "was already followed"}.`,
          );
        } catch (error) {
          renderSuggestedSources();
          status(suggestedSourcesStatus, error.message || String(error), true);
        }
      });
      item.append(details, follow);
      list.append(item);
    }
    group.append(heading, list);
    suggestedSources.append(group);
  }
  suggestedCount.textContent = `${visibleSourceCount} sources in ${visibleCategoryCount} categories`;
  if (!visibleSourceCount) {
    const empty = document.createElement("p");
    empty.className = "no-suggested-results";
    empty.textContent = "No suggested sources match your search.";
    suggestedSources.append(empty);
  }
}

async function exportFeeds() {
  exportFeedsButton.disabled = true;
  try {
    const documentData = await request("feeds:export");
    const contents = `${JSON.stringify(documentData, null, 2)}\n`;
    const blobUrl = URL.createObjectURL(
      new Blob([contents], { type: "application/json" }),
    );
    const download = document.createElement("a");
    download.href = blobUrl;
    download.download = `news-feed-pulse-feeds-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    status(
      feedListStatus,
      `${state.feeds.length} feed${state.feeds.length === 1 ? "" : "s"} exported locally.`,
    );
  } catch (error) {
    status(feedListStatus, error.message || String(error), true);
  } finally {
    exportFeedsButton.disabled = !state.feeds.length;
  }
}

function importSummary(result) {
  const parts = [
    `${Number(result.added) || 0} added`,
    `${Number(result.existing) || 0} already subscribed`,
    `${Number(result.failed) || 0} failed`,
  ];
  const failures = Array.isArray(result.failures)
    ? result.failures.slice(0, 3)
    : [];
  if (failures.length) {
    const details = failures
      .map((failure) => {
        if (typeof failure === "string") return failure;
        return [failure?.url, failure?.message].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (details.length) parts.push(details.join("; "));
  }
  return `Import complete: ${parts.join(" · ")}.`;
}

async function importFeeds(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    status(
      feedListStatus,
      "That file is larger than the 1 MiB import limit.",
      true,
    );
    return;
  }
  importFeedsButton.disabled = true;
  status(feedListStatus, "Validating and importing feeds…");
  try {
    const parsed = JSON.parse(await file.text());
    const result = await request("feeds:import", { document: parsed });
    state = result.state;
    renderSavedFeeds();
    renderSuggestedSources();
    renderResults(currentCandidates);
    status(feedListStatus, importSummary(result), Number(result.failed) > 0);
  } catch (error) {
    status(
      feedListStatus,
      error instanceof SyntaxError
        ? "That file does not contain valid JSON."
        : error.message || String(error),
      true,
    );
  } finally {
    importFeedsButton.disabled = false;
  }
}

function renderResults(candidates) {
  currentCandidates = candidates;
  feedResults.replaceChildren();
  const existing = new Set(
    state.feeds.flatMap((feed) =>
      [feed.url, feed.requestedUrl].filter(Boolean),
    ),
  );
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
        status(
          feedStatus,
          `${result.feed.title} ${result.added ? "was added" : "is already subscribed"}.`,
        );
        renderSavedFeeds();
        renderSuggestedSources();
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
  try {
    await saveSettings();
  } catch (error) {
    status(settingsStatus, error.message || String(error), true);
  }
});

document.getElementById("test-toast").addEventListener("click", async () => {
  try {
    await saveSettings();
    const result = await request("toast:test");
    status(
      settingsStatus,
      result.delivered
        ? "The test toast is visible on the active webpage."
        : "The test toast is queued and will appear when an eligible webpage tab is ready.",
    );
  } catch (error) {
    status(settingsStatus, error.message || String(error), true);
  }
});

document
  .getElementById("add-feed-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("feed-url");
    const button = document.getElementById("find-feeds");
    button.disabled = true;
    status(feedStatus, "Checking the page and validating feed links…");
    feedResults.replaceChildren();
    try {
      const result = await request("feeds:discover", {
        url: input.value.trim(),
      });
      status(
        feedStatus,
        `${result.candidates.length} working feed${result.candidates.length === 1 ? "" : "s"} found.`,
      );
      renderResults(result.candidates);
    } catch (error) {
      status(feedStatus, error.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  });

document
  .getElementById("refresh-feeds")
  .addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Refreshing…";
    try {
      const result = await request("feeds:refresh");
      state = result.state;
      renderSavedFeeds();
      status(feedListStatus, "Feeds refreshed.");
    } catch (error) {
      status(feedListStatus, error.message || String(error), true);
    } finally {
      button.disabled = false;
      button.textContent = "Refresh all";
    }
  });

suggestedSearch.addEventListener("input", renderSuggestedSources);
exportFeedsButton.addEventListener("click", exportFeeds);
importFeedsButton.addEventListener("click", () => importFeedsFile.click());
importFeedsFile.addEventListener("change", () => {
  const file = importFeedsFile.files?.[0];
  importFeedsFile.value = "";
  importFeeds(file);
});

loadSettings().catch((error) =>
  status(settingsStatus, error.message || String(error), true),
);
