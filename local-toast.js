(() => {
  "use strict";

  const controllerKey = "__newsFeedPulseToastController";
  const previousController = globalThis[controllerKey];
  if (typeof previousController?.cleanup === "function") {
    previousController.cleanup("defer");
  } else {
    if (previousController?.listener) {
      try { chrome.runtime.onMessage.removeListener(previousController.listener); } catch (_error) {}
    }
    if (previousController?.host?.isConnected) previousController.host.remove();
  }
  try { delete globalThis.__newsFeedPulseToastInstalled; } catch (_error) {}

  const controller = {
    cleanup: null,
    current: null,
    focusListener: null,
    host: null,
    listener: null,
    visibilityListener: null
  };
  const hostId = "news-feed-pulse-toast-host";
  let toastHost = null;
  let toastSlot = null;
  let current = null;

  function sendRuntimeMessage(type, data = {}) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage({ type, data })).catch(() => undefined);
    } catch (_error) {
      return Promise.resolve(undefined);
    }
  }

  function announceReady() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      sendRuntimeMessage("localToast:ready");
    }
  }

  function ensureHost(position) {
    if (!toastHost || !toastHost.isConnected) {
      toastHost = document.createElement("div");
      toastHost.id = hostId;
      const shadow = toastHost.attachShadow({ mode: "closed" });
      shadow.innerHTML = `
        <style>
          :host { all: initial; position: fixed; z-index: 2147483647; pointer-events: none; }
          :host([data-position="top-right"]) { top: 14px; right: 14px; }
          :host([data-position="top-left"]) { top: 14px; left: 14px; }
          :host([data-position="bottom-right"]) { bottom: 14px; right: 14px; }
          :host([data-position="bottom-left"]) { bottom: 14px; left: 14px; }
          #slot { width: min(360px, calc(100vw - 28px)); }
          .toast { box-sizing: border-box; display: grid; grid-template-columns: 42px 1fr 24px; gap: 10px;
            width: 100%; padding: 12px; border: 1px solid #465063; border-left: 4px solid #8b7cff; border-radius: 12px;
            background: #171a21; color: #f8fafc;
            box-shadow: 0 16px 42px rgba(0, 0, 0, .58), 0 0 0 1px rgba(255, 255, 255, .04);
            font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            pointer-events: auto; cursor: pointer; animation: enter .18s ease-out; }
          .toast:hover { border-color: #8b7cff; background: #1e232c; }
          img { box-sizing: border-box; width: 38px; height: 38px; padding: 3px; object-fit: contain; border: 1px solid #3a4250; border-radius: 8px; background: #242a34; }
          .title { margin: 0 0 3px; color: #f8fafc; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
          .message { color: #c4cbd6; overflow-wrap: anywhere; }
          button { appearance: none; border: 0; border-radius: 6px; background: transparent; color: #b5bdc9; cursor: pointer;
            font: 20px/20px sans-serif; padding: 0; width: 24px; height: 24px; }
          button:hover, button:focus-visible { background: #343b49; color: #fff; outline: 2px solid #9a8cff; }
          @keyframes enter { from { opacity: 0; transform: translateY(-8px) scale(.98); } }
          @media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
        </style>
        <div id="slot" role="region" aria-label="RSS feed notification"></div>`;
      toastSlot = shadow.getElementById("slot");
      document.documentElement.appendChild(toastHost);
      controller.host = toastHost;
    }
    toastHost.dataset.position = position || "top-right";
    return toastSlot;
  }

  function detachCurrent() {
    if (!current) return null;
    const detached = current;
    current = null;
    controller.current = null;
    window.clearTimeout(detached.timer);
    detached.toast.remove();
    return detached;
  }

  function finishCurrent(type) {
    const detached = detachCurrent();
    if (!detached) return;
    sendRuntimeMessage(type, { deliveryId: detached.deliveryId });
  }

  function openCurrent() {
    const detached = detachCurrent();
    if (!detached) return;
    const open = sendRuntimeMessage("localToast:open", {
      postId: detached.data.postId,
      url: detached.data.link
    });
    open.finally(() => sendRuntimeMessage("localToast:complete", { deliveryId: detached.deliveryId }));
  }

  function showToast(data) {
    const slot = ensureHost(data.position);
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    const icon = document.createElement("img");
    icon.src = data.iconUrl || chrome.runtime.getURL("extension-icons/icon48x48.png");
    icon.alt = "";
    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = data.title || "New feed item";
    const message = document.createElement("div");
    message.className = "message";
    message.textContent = data.message || "";
    text.append(title, message);
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    close.addEventListener("click", event => {
      event.stopPropagation();
      finishCurrent("localToast:complete");
    });
    toast.append(icon, text, close);
    toast.addEventListener("click", openCurrent);
    slot.replaceChildren(toast);

    const numericDuration = Number(data.duration);
    const duration = Math.max(2000, Math.min(Number.isFinite(numericDuration) ? numericDuration : 3000, 300000));
    current = {
      data,
      deliveryId: data.deliveryId,
      timer: window.setTimeout(() => finishCurrent("localToast:complete"), duration),
      toast
    };
    controller.current = current;
  }

  controller.listener = (message, _sender, sendResponse) => {
    const type = message?.type;
    const data = message?.data || {};
    if (type === "localToast:deliver") {
      const deliveryId = typeof data.deliveryId === "string" ? data.deliveryId : "";
      if (!deliveryId || document.visibilityState !== "visible" || (current && current.deliveryId !== deliveryId)) {
        sendResponse({ accepted: false });
        return false;
      }
      if (!current) showToast(data);
      sendResponse({ accepted: true });
      return false;
    }
    if (type === "localToast:cancel") {
      const cancelled = Boolean(current && current.deliveryId === data.deliveryId);
      if (cancelled) detachCurrent();
      sendResponse({ cancelled });
      return false;
    }
    return false;
  };

  controller.visibilityListener = () => {
    if (document.visibilityState === "hidden") finishCurrent("localToast:defer");
    else announceReady();
  };
  controller.focusListener = announceReady;
  controller.cleanup = signal => {
    try { chrome.runtime.onMessage.removeListener(controller.listener); } catch (_error) {}
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", controller.visibilityListener);
    }
    if (typeof window !== "undefined") window.removeEventListener("focus", controller.focusListener);
    if (signal === "defer") finishCurrent("localToast:defer");
    else detachCurrent();
    if (toastHost?.isConnected) toastHost.remove();
    controller.host = null;
  };

  chrome.runtime.onMessage.addListener(controller.listener);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", controller.visibilityListener);
  }
  if (typeof window !== "undefined") window.addEventListener("focus", controller.focusListener);
  globalThis[controllerKey] = controller;
  announceReady();
})();
