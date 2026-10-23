(() => {
  "use strict";
  const DEFAULT_POSITION = "top-right";
  const inputs = [...document.querySelectorAll('input[name="position"]')];
  const status = document.getElementById("status");

  chrome.storage.local.get({ toastPosition: DEFAULT_POSITION }).then(({ toastPosition }) => {
    const selected = inputs.find((input) => input.value === toastPosition) || inputs[0];
    selected.checked = true;
  });

  inputs.forEach((input) => input.addEventListener("change", async () => {
    if (!input.checked) return;
    await chrome.storage.local.set({ toastPosition: input.value });
    status.textContent = `Saved: ${input.nextElementSibling.nextElementSibling.textContent}`;
    window.setTimeout(() => { status.textContent = ""; }, 1800);
  }));
})();
