const defaults = { localToastEnabled: true, localToastPosition: "top-right", localToastDuration: 8000 };
const enabledInput = document.getElementById("toast-enabled");
const positionInput = document.getElementById("toast-position");
const durationInput = document.getElementById("toast-duration");
const settingsStatus = document.getElementById("settings-status");
const feedStatus = document.getElementById("feed-status");

async function loadSettings() {
  const settings = await chrome.storage.local.get(defaults);
  enabledInput.checked = settings.localToastEnabled;
  positionInput.value = settings.localToastPosition;
  durationInput.value = String(settings.localToastDuration);
}

async function saveSettings() {
  await chrome.storage.local.set({
    localToastEnabled: enabledInput.checked,
    localToastPosition: positionInput.value,
    localToastDuration: Number(durationInput.value)
  });
  const preferenceResponse = await apiRequest("POST", "/1/preferences", {
    preferences: { "global:notifications": enabledInput.checked }
  });
  if (preferenceResponse.status < 200 || preferenceResponse.status >= 300) {
    throw new Error("Could not update the local feed-notification preference.");
  }
  settingsStatus.className = "";
  settingsStatus.textContent = "Settings saved.";
}

function apiRequest(method, url, data) {
  return new Promise((resolve, reject) => {
    const requestId = `local-settings-${Date.now()}-${Math.random()}`;
    const port = chrome.runtime.connect({ name: `local-settings:${requestId}` });
    const timeout = setTimeout(() => { port.disconnect(); reject(new Error("The local feed parser did not respond.")); }, 30000);
    port.onMessage.addListener((message) => {
      if (message.type !== "api:response" || message.data.requestId !== requestId) return;
      clearTimeout(timeout); port.disconnect(); resolve(message.data);
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) { clearTimeout(timeout); reject(new Error(chrome.runtime.lastError.message)); }
    });
    port.postMessage({ type: "api:request", data: { requestId, method, url, data, headers: {} } });
  });
}

document.getElementById("save-settings").addEventListener("click", async () => {
  try { await saveSettings(); }
  catch (error) { settingsStatus.className = "error"; settingsStatus.textContent = error.message || String(error); }
});
document.getElementById("test-toast").addEventListener("click", async () => {
  try { await saveSettings(); }
  catch (error) { settingsStatus.className = "error"; settingsStatus.textContent = error.message || String(error); return; }
  const tabs = await chrome.tabs.query({});
  const tab = tabs.filter((item) => item.id && /^https?:/i.test(item.url || ""))
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (!tab) { settingsStatus.className = "error"; settingsStatus.textContent = "Open a normal website tab first, then test the toast."; return; }
  await chrome.tabs.sendMessage(tab.id, { type: "localToast:show", data: {
    title: "Toast notifications are working", message: "New RSS items will appear in this corner.",
    position: positionInput.value, duration: Number(durationInput.value), iconUrl: chrome.runtime.getURL("extension-icons/icon48x48.png")
  }});
});

document.getElementById("add-feed-form").addEventListener("submit", async (event) => {
  event.preventDefault(); feedStatus.className = ""; feedStatus.textContent = "Checking and adding feed locally…";
  const input = document.getElementById("feed-url");
  try {
    const url = new URL(input.value.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only HTTP and HTTPS feed URLs are supported.");
    const response = await apiRequest("POST", "/-extension-api/save-local-feed", { feed: { path: url.href } });
    if (response.status < 200 || response.status >= 300) {
      const detail = response.body && (response.body.error || response.body.errors || response.body.errorMessage);
      throw new Error(typeof detail === "string" ? detail : "That URL was not recognized as a valid RSS, Atom, or JSON feed.");
    }
    feedStatus.textContent = "Feed added successfully. Open the reader to view it."; input.value = "";
  } catch (error) { feedStatus.className = "error"; feedStatus.textContent = error.message || String(error); }
});

loadSettings()
  .then(() => saveSettings())
  .catch((error) => {
    settingsStatus.className = "error";
    settingsStatus.textContent = error.message || String(error);
  });
