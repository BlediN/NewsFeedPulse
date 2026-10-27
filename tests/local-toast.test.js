"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.events = new Map();
    this.isConnected = false;
    this.removed = false;
  }

  addEventListener(type, listener) { this.events.set(type, listener); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  remove() { this.isConnected = false; this.removed = true; }

  attachShadow() {
    const slot = new FakeElement("slot");
    return {
      set innerHTML(_value) {},
      getElementById(id) { return id === "slot" ? slot : null; }
    };
  }
}

const listeners = [];
const removed = [];
const runtimeMessages = [];
const documentListeners = new Map();
const windowListeners = new Map();
const timers = new Map();
let nextTimerId = 1;

global.document = {
  visibilityState: "visible",
  documentElement: {
    appendChild(element) { element.isConnected = true; }
  },
  createElement(tagName) { return new FakeElement(tagName); },
  addEventListener(type, listener) { documentListeners.set(type, listener); },
  removeEventListener(type) { documentListeners.delete(type); }
};

global.window = {
  setTimeout(callback, delay) {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  addEventListener(type, listener) { windowListeners.set(type, listener); },
  removeEventListener(type) { windowListeners.delete(type); }
};

global.chrome = {
  runtime: {
    getURL(pathname) { return `chrome-extension://test/${pathname}`; },
    sendMessage(message) { runtimeMessages.push(message); return Promise.resolve(); },
    onMessage: {
      addListener(listener) { listeners.push(listener); },
      removeListener(listener) { removed.push(listener); }
    }
  }
};

const scriptPath = path.resolve(__dirname, "../local-toast.js");
require(scriptPath);
const firstListener = listeners[0];
assert.equal(typeof firstListener, "function");
assert.equal(runtimeMessages[0].type, "localToast:ready", "a visible tab should announce that it can receive queued toasts");

let response;
const handled = firstListener({
  type: "localToast:deliver",
  data: {
    deliveryId: "delivery-1",
    title: "Latest story",
    message: "Example feed",
    duration: 3000,
    position: "top-right"
  }
}, {}, value => { response = value; });
assert.equal(handled, false);
assert.deepEqual(response, { accepted: true });
assert.equal(timers.size, 1);
const timer = [...timers.values()][0];
assert.equal(timer.delay, 3000, "the requested three-second duration should reach the actual removal timer");
const toast = globalThis.__newsFeedPulseToastController.current.toast;
timer.callback();
assert.equal(toast.removed, true, "the toast should be removed when its three-second timer fires");
assert.equal(globalThis.__newsFeedPulseToastController.current, null);
assert.deepEqual(runtimeMessages.at(-1), {
  type: "localToast:complete",
  data: { deliveryId: "delivery-1" }
});

response = undefined;
firstListener({
  type: "localToast:deliver",
  data: {
    deliveryId: "delivery-with-deadline",
    duration: 500,
    toastExpiresAt: Date.now() + 500
  }
}, {}, value => { response = value; });
assert.deepEqual(response, { accepted: true });
const deadlineTimer = [...timers.values()][0];
assert.ok(deadlineTimer.delay > 0 && deadlineTimer.delay <= 500,
  "a re-delivered toast must honor a remaining duration shorter than two seconds");
deadlineTimer.callback();

document.visibilityState = "hidden";
response = undefined;
firstListener({ type: "localToast:deliver", data: { deliveryId: "hidden-delivery", duration: 3000 } }, {}, value => { response = value; });
assert.deepEqual(response, { accepted: false }, "a hidden tab must reject a toast so the background can move it to the active tab");
document.visibilityState = "visible";

delete require.cache[scriptPath];
require(scriptPath);

assert.equal(removed.length, 1, "reinjection should remove the previous runtime listener");
assert.equal(removed[0], firstListener);
assert.equal(listeners.length, 2, "reinjection should install a fresh runtime listener");
assert.notEqual(listeners[1], firstListener);

console.log("local toast lifecycle tests passed");
