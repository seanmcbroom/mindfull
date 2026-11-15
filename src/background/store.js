// State persistence. The background is the only writer; all writes go through
// mutate(), which serialises read-modify-write cycles so concurrent messages can't race.

const { DEFAULT_SETTINGS, DEFAULT_RUNTIME } = require("../shared/defaults");

const KEYS = ["settings", "runtime", "stats", "usage"];

async function loadState() {
  const raw = await chrome.storage.local.get(KEYS);
  return {
    settings: { ...structuredClone(DEFAULT_SETTINGS), ...(raw.settings || {}) },
    runtime: { ...structuredClone(DEFAULT_RUNTIME), ...(raw.runtime || {}) },
    stats: raw.stats || {},
    usage: raw.usage || {},
  };
}

let queue = Promise.resolve();

/**
 * Run fn(draft) against freshly loaded state. fn may mutate the draft in place or
 * return { state, result }. Saves only if something changed. Resolves to { state, result }.
 */
function mutate(fn) {
  const run = queue.then(async () => {
    const draft = await loadState();
    const before = JSON.stringify(draft);
    const out = await fn(draft);
    const isEnvelope = out && typeof out === "object" && "state" in out;
    const state = isEnvelope ? out.state : draft;
    const result = isEnvelope ? out.result : out;
    if (JSON.stringify(state) !== before) {
      await chrome.storage.local.set({ settings: state.settings, runtime: state.runtime, stats: state.stats, usage: state.usage });
    }
    return { state, result };
  });
  queue = run.catch(() => {});
  return run;
}

module.exports = { loadState, mutate };
