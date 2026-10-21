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
  const isBlocked = (input) => {
    try {
      const value = typeof input === "string" ? input : input && input.url;
      return blockedHosts.has(new URL(value, location.href).hostname.toLowerCase());
    } catch (_error) { return false; }
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => isBlocked(input)
    ? Promise.resolve(new Response('{"error":"External service disabled"}', { status: 451, headers: { "Content-Type": "application/json" } }))
    : nativeFetch(input, init);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__localPrivacyBlocked = isBlocked(url);
    if (this.__localPrivacyBlocked) {
      return nativeOpen.call(this, "GET", chrome.runtime.getURL("privacy-empty.json"), ...rest);
    }
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__localPrivacyBlocked) return nativeSend.call(this, null);
    return nativeSend.call(this, body);
  };
  if (navigator.sendBeacon) {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => isBlocked(url) ? true : nativeBeacon(url, data);
  }
  if (window.WebSocket) {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      if (isBlocked(url)) throw new Error("External WebSocket disabled");
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  }
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest && event.target.closest("a[href]");
    if (anchor && isBlocked(anchor.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
