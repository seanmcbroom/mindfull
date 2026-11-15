const { DEFAULT_SETTINGS, DEFAULT_RUNTIME } = require("../src/shared/defaults");

/** Local time helper: at(2026, 11, 16, 10, 0) = Mon 16 Nov 2026 10:00 local. Month is 1-based. */
function at(y, mo, d, h = 0, mi = 0, s = 0) {
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

const MON = at(2026, 11, 16, 10, 0); // Monday 10:00

function makeState({ settings = {}, runtime = {}, stats = {}, usage = {} } = {}) {
  return {
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      sites: [{ domain: "youtube.com", dailyLimit: null }, { domain: "reddit.com", dailyLimit: null }],
      ...settings,
    },
    runtime: { ...structuredClone(DEFAULT_RUNTIME), ...runtime },
    stats,
    usage,
  };
}

module.exports = { at, MON, makeState };
