(() => {
  const controllerKey = "__newsFeedPulseToastController";
  const previousController = globalThis[controllerKey];
  if (previousController?.listener) {
    try { chrome.runtime.onMessage.removeListener(previousController.listener); } catch (_error) {}
  }
  if (previousController?.host?.isConnected) previousController.host.remove();
  try { delete globalThis.__newsFeedPulseToastInstalled; } catch (_error) {}

  const controller = { listener: null, host: null };
  const hostId = "news-feed-pulse-toast-host";
  let toastHost = null;
  let toastStack = null;

  function ensureStack(position) {
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
          #stack { display: flex; flex-direction: column; gap: 10px; width: min(360px, calc(100vw - 28px)); }
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
        <div id="stack" role="region" aria-label="RSS feed notifications"></div>`;
      toastStack = shadow.getElementById("stack");
      document.documentElement.appendChild(toastHost);
      controller.host = toastHost;
    }
    toastHost.dataset.position = position || "top-right";
    return toastStack;
  }

  function showToast(data) {
    const stack = ensureStack(data.position);
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
    close.addEventListener("click", (event) => { event.stopPropagation(); toast.remove(); });
    toast.append(icon, text, close);
    toast.addEventListener("click", () => {
      if (data.link) chrome.runtime.sendMessage({ type: "localToast:open", data: { postId: data.postId, url: data.link } }).catch(() => undefined);
      toast.remove();
    });
    stack.prepend(toast);
    while (stack.children.length > 4) stack.lastElementChild.remove();
    const duration = Math.max(2000, Math.min(Number(data.duration) || 300000, 300000));
    window.setTimeout(() => toast.remove(), duration);
  }

  controller.listener = (message) => {
    if (message && message.type === "localToast:show" && message.data) showToast(message.data);
  };
  chrome.runtime.onMessage.addListener(controller.listener);
  globalThis[controllerKey] = controller;
})();
