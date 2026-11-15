const { siteStatus, effectiveLimit } = require("../src/shared/policy");
const { dayKey } = require("../src/shared/time");
const { at, MON, makeState } = require("./helpers");

const MIN = 60000;
const today = dayKey(MON);

describe("siteStatus", () => {
  test("unlisted sites are allowed", () => {
    expect(siteStatus(makeState(), "example.com", MON)).toMatchObject({ mode: "allowed", reason: "unlisted" });
  });

  test("listed site with nothing special -> pause with base wait", () => {
    expect(siteStatus(makeState(), "youtube.com", MON)).toMatchObject({
      mode: "pause",
      waitSeconds: 10,
      unlocksToday: 0,
      limit: 5,
    });
  });

  test("wait escalates with today's unlock count", () => {
    const s = makeState({ stats: { [today]: { "youtube.com": 2 } } });
    expect(siteStatus(s, "youtube.com", MON)).toMatchObject({ mode: "pause", waitSeconds: 40, unlocksToday: 2 });
    expect(siteStatus(s, "reddit.com", MON).waitSeconds).toBe(10);
  });

  test("active unlock -> allowed until expiry", () => {
    const s = makeState({ runtime: { unlocks: { "youtube.com": MON + 5 * MIN } } });
    expect(siteStatus(s, "youtube.com", MON)).toMatchObject({ mode: "allowed", reason: "unlocked", until: MON + 5 * MIN });
    expect(siteStatus(s, "youtube.com", MON + 5 * MIN).mode).toBe("pause");
  });

  test("daily limit reached -> hardblock until midnight, but the unlock that hit it still works", () => {
    const stats = { [today]: { "youtube.com": 5 } };
    expect(siteStatus(makeState({ stats }), "youtube.com", MON)).toMatchObject({
      mode: "hardblock",
      reason: "limit",
      until: at(2026, 11, 17, 0, 0),
    });
    const unlocked = makeState({ stats, runtime: { unlocks: { "youtube.com": MON + MIN } } });
    expect(siteStatus(unlocked, "youtube.com", MON).mode).toBe("allowed");
  });

  test("limit resets the next day", () => {
    const s = makeState({ stats: { [today]: { "youtube.com": 5 } } });
    expect(siteStatus(s, "youtube.com", at(2026, 11, 17, 9, 0)).mode).toBe("pause");
  });

  test("per-site limit override, including 0 = always blocked, and null default = unlimited", () => {
    const s = makeState({
      settings: {
        sites: [{ domain: "youtube.com", dailyLimit: 0 }, { domain: "reddit.com", dailyLimit: null }],
        defaultDailyLimit: null,
      },
      stats: { [today]: { "reddit.com": 99 } },
    });
    expect(effectiveLimit(s.settings, "youtube.com")).toBe(0);
    expect(siteStatus(s, "youtube.com", MON)).toMatchObject({ mode: "hardblock", reason: "limit" });
    expect(siteStatus(s, "reddit.com", MON).mode).toBe("pause");
  });

  test("restricted hours hardblock and override an active unlock", () => {
    const s = makeState({
      settings: { schedules: [{ id: "w", days: [1], start: "09:00", end: "17:00", sites: ["youtube.com"] }] },
      runtime: { unlocks: { "youtube.com": MON + 5 * MIN } },
    });
    expect(siteStatus(s, "youtube.com", MON)).toMatchObject({
      mode: "hardblock",
      reason: "schedule",
      until: at(2026, 11, 16, 17, 0),
    });
    expect(siteStatus(s, "reddit.com", MON).mode).toBe("pause");
  });

  test("focus hardblocks every listed site", () => {
    const s = makeState({ runtime: { focus: { endsAt: MON + 25 * MIN }, unlocks: { "reddit.com": MON + MIN } } });
    expect(siteStatus(s, "youtube.com", MON)).toMatchObject({ mode: "hardblock", reason: "focus", until: MON + 25 * MIN });
    expect(siteStatus(s, "reddit.com", MON).mode).toBe("hardblock");
    expect(siteStatus(s, "youtube.com", MON + 25 * MIN).mode).toBe("pause");
  });

  test("paused protection beats everything", () => {
    const s = makeState({ runtime: { paused: { until: null }, focus: { endsAt: MON + MIN } } });
    expect(siteStatus(s, "youtube.com", MON)).toMatchObject({ mode: "allowed", reason: "paused" });
    const timed = makeState({ runtime: { paused: { until: MON + MIN } } });
    expect(siteStatus(timed, "youtube.com", MON).mode).toBe("allowed");
    expect(siteStatus(timed, "youtube.com", MON + MIN).mode).toBe("pause");
  });
});
