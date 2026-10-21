"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const listeners = [];
const removed = [];

global.chrome = {
  runtime: {
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

delete require.cache[scriptPath];
require(scriptPath);

assert.equal(removed.length, 1, "reinjection should remove the previous runtime listener");
assert.equal(removed[0], firstListener);
assert.equal(listeners.length, 2, "reinjection should install a fresh runtime listener");
assert.notEqual(listeners[1], firstListener);

console.log("local toast reinjection test passed");
