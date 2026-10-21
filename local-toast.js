(() => {
  if (globalThis.__newsFeedPulseToastInstalled) return;
  globalThis.__newsFeedPulseToastInstalled = true;
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
            width: 100%; padding: 12px; border: 1px solid #d9dce5; border-radius: 12px;
            background: #fff; color: #171923; box-shadow: 0 12px 35px rgba(24, 28, 45, .22);
            font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            pointer-events: auto; cursor: pointer; animation: enter .18s ease-out; }
          .toast:hover { border-color: #7667dc; }
          img { width: 38px; height: 38px; object-fit: contain; border-radius: 8px; }
          .title { margin: 0 0 3px; font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
          .message { color: #5a6072; overflow-wrap: anywhere; }
          button { appearance: none; border: 0; background: transparent; color: #697083; cursor: pointer;
            font: 20px/20px sans-serif; padding: 0; width: 24px; height: 24px; }
          @keyframes enter { from { opacity: 0; transform: translateY(-8px) scale(.98); } }
        </style>
        <div id="stack" role="region" aria-label="RSS feed notifications"></div>`;
      toastStack = shadow.getElementById("stack");
      document.documentElement.appendChild(toastHost);
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
    const duration = Math.max(2000, Math.min(Number(data.duration) || 8000, 60000));
    window.setTimeout(() => toast.remove(), duration);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "localToast:show" && message.data) showToast(message.data);
  });
})();
