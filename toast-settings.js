(() => {
  "use strict";
  const DEFAULT_POSITION = "top-right";
  const DEFAULT_DURATION_SECONDS = 3;
  const DEFAULT_INTERVAL_MINUTES = 2;
  const positionInputs = [...document.querySelectorAll('input[name="position"]')];
  const durationInputs = [...document.querySelectorAll('input[name="duration"]')];
  const intervalSelect = document.getElementById("feed-interval");
  const status = document.getElementById("status");

  function showSaved(message) {
    status.textContent = message;
    window.setTimeout(() => { status.textContent = ""; }, 1800);
  }

  chrome.storage.local.get({
    toastPosition: DEFAULT_POSITION,
    toastDurationSeconds: DEFAULT_DURATION_SECONDS
  }).then(({ toastPosition, toastDurationSeconds }) => {
    const selected = positionInputs.find((input) => input.value === toastPosition) || positionInputs[0];
    selected.checked = true;
    const duration = durationInputs.find((input) => Number(input.value) === Number(toastDurationSeconds)) || durationInputs[0];
    duration.checked = true;
  });

  chrome.runtime.sendMessage({ type: "feeder:getGlobalInterval", data: {} })
    .then((response) => {
      const minutes = Number(response && response.minutes) || DEFAULT_INTERVAL_MINUTES;
      intervalSelect.value = String(minutes);
      if (!intervalSelect.value) intervalSelect.value = String(DEFAULT_INTERVAL_MINUTES);
    })
    .catch(() => { intervalSelect.value = String(DEFAULT_INTERVAL_MINUTES); });

  positionInputs.forEach((input) => input.addEventListener("change", async () => {
    if (!input.checked) return;
    await chrome.storage.local.set({ toastPosition: input.value });
    showSaved(`Saved: ${input.nextElementSibling.nextElementSibling.textContent}`);
  }));

  durationInputs.forEach((input) => input.addEventListener("change", async () => {
    if (!input.checked) return;
    await chrome.storage.local.set({ toastDurationSeconds: Number(input.value) });
    showSaved(`Toast duration saved: ${input.value} seconds`);
  }));

  intervalSelect.addEventListener("change", async () => {
    const minutes = Number(intervalSelect.value);
    try {
      const response = await chrome.runtime.sendMessage({
        type: "feeder:setGlobalInterval",
        data: { minutes }
      });
      showSaved(response && response.ok ? `Global interval saved: ${minutes} minutes` : "Could not save the interval");
    } catch (error) {
      showSaved("Could not save the interval");
    }
  });
})();
