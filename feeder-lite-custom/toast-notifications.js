(() => {
  "use strict";

  if (globalThis.__feederToastNotificationsLoaded) return;
  globalThis.__feederToastNotificationsLoaded = true;

  const ROOT_ID = "feeder-toast-root";
  const VALID_POSITIONS = new Set(["top-right", "top-left", "bottom-right", "bottom-left"]);

  function getRoot(position) {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "Feed notifications");
      (document.body || document.documentElement).appendChild(root);
    }
    root.dataset.position = VALID_POSITIONS.has(position) ? position : "top-right";
    return root;
  }

  function removeToast(toast) {
    if (!toast || toast.dataset.removing === "true") return;
    toast.dataset.removing = "true";
    toast.classList.add("feeder-toast--leaving");
    window.setTimeout(() => {
      const root = toast.parentElement;
      toast.remove();
      if (root && !root.childElementCount) root.remove();
    }, 180);
  }

  function showToast(data) {
    if (!data || !data.title) return;
    const durationSeconds = Number(data.durationSeconds) === 5 ? 5 : 3;
    const remainingMs = Number(data.expiresAt) > 0
      ? Number(data.expiresAt) - Date.now()
      : durationSeconds * 1000;
    if (remainingMs <= 0) return;
    const root = getRoot(data.position);
    [...root.children].forEach((item) => {
      if (Number(item.dataset.expiresAt) > 0 && Number(item.dataset.expiresAt) <= Date.now()) item.remove();
    });
    if (data.toastKey && [...root.children].some((item) => item.dataset.toastKey === data.toastKey)) return;
    const toast = document.createElement("div");
    toast.className = "feeder-toast";
    toast.setAttribute("role", "status");
    toast.tabIndex = 0;
    if (data.toastKey) toast.dataset.toastKey = data.toastKey;
    if (data.expiresAt) toast.dataset.expiresAt = String(data.expiresAt);

    const icon = document.createElement("img");
    icon.className = "feeder-toast__icon";
    icon.alt = "";
    icon.src = chrome.runtime.getURL("extension-icons/icon48x48.png");

    const content = document.createElement("div");
    content.className = "feeder-toast__content";
    const title = document.createElement("div");
    title.className = "feeder-toast__title";
    title.textContent = String(data.title);
    content.appendChild(title);
    if (data.message) {
      const message = document.createElement("div");
      message.className = "feeder-toast__message";
      message.textContent = String(data.message);
      content.appendChild(message);
    }

    const close = document.createElement("button");
    close.className = "feeder-toast__close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "\u00d7";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      dismissGlobally(data);
      removeToast(toast);
    });

    const openPost = () => {
      dismissGlobally(data);
      if (data.id && data.link) {
        chrome.runtime.sendMessage({
          type: "feeder:toastClicked",
          data: { id: data.id, link: data.link, toastKey: data.toastKey }
        }).catch(() => {});
      }
      removeToast(toast);
    };
    toast.addEventListener("click", openPost);
    toast.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPost();
      }
    });
    toast.append(icon, content, close);
    root.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
      if (!root.childElementCount) root.remove();
      if (data.toastKey) {
        chrome.runtime.sendMessage({
          type: "feeder:toastExpired",
          data: { toastKey: data.toastKey }
        }).catch(() => {});
      }
    }, remainingMs);
  }

  function dismissGlobally(data) {
    if (!data || !data.toastKey) return;
    chrome.runtime.sendMessage({
      type: "feeder:dismissToast",
      data: { toastKey: data.toastKey }
    }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "feeder:showToast") showToast(message.data);
    if (message && message.type === "feeder:removeToast" && message.data) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const toast = [...root.children].find((item) => item.dataset.toastKey === message.data.toastKey);
      if (toast) removeToast(toast);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    [...root.children].forEach((item) => {
      if (Number(item.dataset.expiresAt) > 0 && Number(item.dataset.expiresAt) <= Date.now()) item.remove();
    });
    if (!root.childElementCount) root.remove();
  });
})();
