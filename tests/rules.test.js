const { buildRules, rulesSignature } = require("../src/shared/rules");
const { toRegexFilter } = require("../src/shared/domains");
const { MON, makeState } = require("./helpers");

const PAUSE = "chrome-extension://abc/src/pause.html";
const MIN = 60000;
const filters = (rules) => rules.filter((r) => r.action.type === "redirect").map((r) => r.condition.regexFilter);

test("one redirect rule per blocked site, carrying the URL in the hash", () => {
  const rules = buildRules(makeState(), MON, PAUSE);
  expect(rules).toEqual([
    {
      id: 1,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: PAUSE + "#\\0" } },
      condition: { regexFilter: toRegexFilter("reddit.com"), resourceTypes: ["main_frame"] },
    },
    {
      id: 2,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: PAUSE + "#\\0" } },
      condition: { regexFilter: toRegexFilter("youtube.com"), resourceTypes: ["main_frame"] },
    },
  ]);
});

test("unlocked sites are excluded", () => {
  const s = makeState({ runtime: { unlocks: { "youtube.com": MON + MIN } } });
  expect(filters(buildRules(s, MON, PAUSE))).toEqual([toRegexFilter("reddit.com")]);
});

test("focus blocks everything, even unlocked sites", () => {
  const s = makeState({ runtime: { focus: { endsAt: MON + MIN }, unlocks: { "youtube.com": MON + MIN } } });
  expect(filters(buildRules(s, MON, PAUSE))).toHaveLength(2);
});

test("no rules while protection is paused", () => {
  const s = makeState({ runtime: { paused: { until: null } } });
  expect(buildRules(s, MON, PAUSE)).toEqual([]);
});

test("allowed subdomain under a blocked parent gets a higher-priority allow rule", () => {
  const s = makeState({
    settings: { sites: [{ domain: "youtube.com", dailyLimit: null }, { domain: "music.youtube.com", dailyLimit: null }] },
    runtime: { unlocks: { "music.youtube.com": MON + MIN } },
  });
  const rules = buildRules(s, MON, PAUSE);
  expect(filters(rules)).toEqual([toRegexFilter("youtube.com")]);
  expect(rules.find((r) => r.action.type === "allow")).toMatchObject({
    priority: 2,
    condition: { requestDomains: ["music.youtube.com"], resourceTypes: ["main_frame"] },
  });
  expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
});

test("rulesSignature ignores order, ids and extra fields", () => {
  const rules = buildRules(makeState(), MON, PAUSE);
  const readBack = [...rules].reverse().map((r, i) => ({
    ...r,
    id: 100 + i,
    condition: { ...r.condition, isUrlFilterCaseSensitive: false },
  }));
  expect(rulesSignature(readBack)).toBe(rulesSignature(rules));
  expect(rulesSignature([])).not.toBe(rulesSignature(rules));
});
