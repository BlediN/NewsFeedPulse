/* Local-first bootstrap for the original bundled service worker. */
(() => {
  const blockedHosts = new Set([
    "feeder.co", "www.feeder.co", "analytics.feeder.co", "errors.feeder.co",
    "notifications.feeder.co", "pusher.feeder.co", "adder.feeder.co",
    "content.feeder.co", "widgets.feeder.co", "assets.feedercdn.com",
    "static.feedercdn.com", "icons.feedercdn.com",
    "feedercdn-assets.nyc3.cdn.digitaloceanspaces.com",
    "feedercdn-static.nyc3.digitaloceanspaces.com",
    "feederstaging.com", "www.feederstaging.com", "feederdev.com", "www.feederdev.com"
  ]);

  function blockedUrl(input) {
    try {
      const value = typeof input === "string" ? input : input && input.url;
      if (!value) return false;
      return blockedHosts.has(new URL(value, self.location.href).hostname.toLowerCase());
    } catch (_error) { return false; }
  }

  const trackingHosts = new Set(["analytics.feeder.co", "errors.feeder.co"]);
  function isTrackingUrl(input) {
    try {
      const value = typeof input === "string" ? input : input && input.url;
      return trackingHosts.has(new URL(value, self.location.href).hostname.toLowerCase());
    } catch (_error) { return false; }
  }

  const nativeFetch = self.fetch.bind(self);
  self.fetch = (input, init) => blockedUrl(input)
    ? Promise.resolve(new Response(isTrackingUrl(input) ? "{}" : '{"error":"External Feeder service disabled by local privacy mode"}', {
        status: isTrackingUrl(input) ? 200 : 451,
        headers: { "Content-Type": "application/json" }
      }))
    : nativeFetch(input, init);

  if (self.registration && self.registration.pushManager) {
    try {
      Object.defineProperty(self.registration.pushManager, "subscribe", {
        value: () => Promise.reject(new DOMException("Web push disabled by local privacy mode", "NotAllowedError"))
      });
    } catch (_error) {}
  }

  if (self.WebSocket) {
    const NativeWebSocket = self.WebSocket;
    self.WebSocket = function(url, protocols) {
      if (blockedUrl(url)) throw new Error("External WebSocket disabled by local privacy mode");
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    };
    self.WebSocket.prototype = NativeWebSocket.prototype;
  }

  const nativeTabsCreate = chrome.tabs.create.bind(chrome.tabs);
  chrome.tabs.create = (properties, callback) => {
    if (properties && blockedUrl(properties.url)) {
      if (typeof callback === "function") callback(undefined);
      return Promise.resolve(undefined);
    }
    return typeof callback === "function"
      ? nativeTabsCreate(properties, callback)
      : nativeTabsCreate(properties);
  };

  const notificationSeparator = "#!fdr!#";

  async function sendToast(notificationId, options = {}) {
    const settings = await chrome.storage.local.get({
      localToastEnabled: true,
      localToastPosition: "top-right",
      localToastDuration: 8000
    });
    if (!settings.localToastEnabled) return notificationId;

    const separatorAt = String(notificationId || "").lastIndexOf(notificationSeparator);
    const payload = {
      id: String(notificationId || `local-toast-${Date.now()}`),
      title: options.title || "New feed item",
      message: options.message || options.body || "",
      iconUrl: options.iconUrl || chrome.runtime.getURL("extension-icons/icon48x48.png"),
      link: separatorAt >= 0 ? String(notificationId).slice(0, separatorAt) : "",
      position: settings.localToastPosition,
      duration: Number(settings.localToastDuration) || 8000
    };

    const tabs = await chrome.tabs.query({});
    const target = tabs.filter((tab) => tab.id && /^https?:/i.test(tab.url || ""))
      .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    for (const tab of target ? [target] : []) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "localToast:show", data: payload });
      } catch (_error) {}
    }
    return payload.id;
  }

  if (chrome.notifications && chrome.notifications.create) {
    const localCreate = (notificationId, options, callback) => {
      if (typeof notificationId === "object") {
        callback = options;
        options = notificationId;
        notificationId = `local-toast-${Date.now()}`;
      }
      const result = sendToast(notificationId, options);
      if (typeof callback === "function") {
        result.then((id) => callback(id));
        return undefined;
      }
      return result;
    };
    try {
      chrome.notifications.create = localCreate;
    } catch (_error) {
      try { Object.defineProperty(chrome.notifications, "create", { value: localCreate }); }
      catch (_ignored) {}
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "localToast:open" && message.data && message.data.url) {
      chrome.tabs.create({ url: message.data.url });
    }
  });
})();

importScripts("mv3.js");
