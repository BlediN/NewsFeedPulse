(() => {
  function applyLocalCapabilities() {
    try {
      const User = window.require("frontend/user/model").default;
      const descriptor = Object.getOwnPropertyDescriptor(User.prototype, "canCan");
      if (!descriptor || typeof descriptor.get !== "function" || descriptor.get.__localFirst) return;
      const originalGet = descriptor.get;
      const localGet = function() {
        const capabilities = originalGet.call(this);
        if (this.isLocalExtensionUser && capabilities && typeof capabilities.set === "function") {
          ["autoUpdates", "customUpdateInterval", "globalCustomUpdateInterval", "collections", "themes",
            "filters", "postActions", "searchLimitedHistory", "dashboard", "superfast"]
            .forEach((name) => capabilities.set(name, true));
          capabilities.set("ads", false);
          capabilities.set("billing", false);
          capabilities.set("backendFeeds", false);
          capabilities.set("emailNotifications", false);
          capabilities.set("pushNotifications", false);
          capabilities.set("anyWebsiteSource", false);
        }
        return capabilities;
      };
      localGet.__localFirst = true;
      Object.defineProperty(User.prototype, "canCan", { ...descriptor, get: localGet });
    } catch (error) { console.warn("Could not apply local capability overrides", error); }
  }
  applyLocalCapabilities();
  window.setTimeout(applyLocalCapabilities, 0);

  function addLocalSettingsShortcut() {
    if (document.getElementById("local-settings-shortcut")) return;
    const button = document.createElement("button");
    button.id = "local-settings-shortcut";
    button.type = "button";
    button.textContent = "+ Add RSS locally";
    button.title = "Add an RSS/Atom URL and configure private notifications";
    Object.assign(button.style, {
      position: "fixed", right: "12px", bottom: "12px", zIndex: "2147483646",
      border: "0", borderRadius: "8px", padding: "9px 12px", cursor: "pointer",
      background: "#5949c6", color: "white",
      font: "600 13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      boxShadow: "0 5px 18px rgba(20, 18, 45, .25)"
    });
    button.addEventListener("click", () => { location.href = chrome.runtime.getURL("local-settings.html"); });
    document.body.appendChild(button);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addLocalSettingsShortcut, { once: true });
  else addLocalSettingsShortcut();
})();
