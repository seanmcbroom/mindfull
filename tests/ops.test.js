const { validateOp, isLoosening, applyOp, advance, describeOp } = require("../src/shared/ops");
const { dayKey } = require("../src/shared/time");
const { MON, makeState } = require("./helpers");

const MIN = 60000;
const sched = { id: "s1", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", sites: ["youtube.com"] };

describe("validateOp", () => {
  const s = makeState();
  test("addSite", () => {
    expect(validateOp({ type: "addSite", domain: "https://www.tiktok.com/foryou" }, s)).toBeNull();
    expect(validateOp({ type: "addSite", domain: "nope" }, s)).toMatch(/website/);
    expect(validateOp({ type: "addSite", domain: "youtube.com" }, s)).toMatch(/already/);
    expect(validateOp({ type: "addSite", domain: "m.youtube.com" }, s)).toMatch(/covered by youtube.com/);
  });

  test("other ops", () => {
    expect(validateOp({ type: "removeSite", domain: "tiktok.com" }, s)).toMatch(/isn't/);
    expect(validateOp({ type: "setDailyLimit", domain: "youtube.com", value: -1 }, s)).toMatch(/Invalid/);
    expect(validateOp({ type: "setSetting", key: "evil", value: 1 }, s)).toMatch(/Unknown/);
    expect(validateOp({ type: "setSetting", key: "unlockDurations", value: [] }, s)).toMatch(/Invalid/);
    expect(validateOp({ type: "addSchedule", schedule: sched }, s)).toBeNull();
    expect(validateOp({ type: "updateSchedule", schedule: sched }, s)).toMatch(/not found/);
    expect(validateOp({ type: "startFocus", minutes: 25 }, s)).toBeNull();
    expect(validateOp({ type: "pauseProtection", minutes: null }, s)).toBeNull();
    expect(validateOp({ type: "bogus" }, s)).toMatch(/Unknown/);
  });
});

describe("isLoosening", () => {
  const s = makeState({ settings: { schedules: [sched] } });
  const loose = (op, state = s, now = MON) => isLoosening(op, state, now);

  test("tightening ops", () => {
    expect(loose({ type: "addSite", domain: "x.com" })).toBe(false);
    expect(loose({ type: "addSchedule", schedule: { ...sched, id: "s2" } })).toBe(false);
    expect(loose({ type: "startFocus", minutes: 25 })).toBe(false);
    expect(loose({ type: "resumeProtection" })).toBe(false);
    expect(loose({ type: "setDailyLimit", domain: "youtube.com", value: 2 })).toBe(false);
    expect(loose({ type: "setSetting", key: "baseWait", value: 30 })).toBe(false);
    expect(loose({ type: "setSetting", key: "cooldownMinutes", value: 30 })).toBe(false);
    expect(loose({ type: "setSetting", key: "defaultDailyLimit", value: 3 })).toBe(false);
    expect(loose({ type: "setSetting", key: "unlockDurations", value: [5, 10] })).toBe(false);
    expect(loose({ type: "updateSchedule", schedule: { ...sched, end: "18:00", sites: "all" } })).toBe(false);
    expect(loose({ type: "endFocus" })).toBe(false); // no focus running
  });

  test("loosening ops", () => {
    expect(loose({ type: "removeSite", domain: "youtube.com" })).toBe(true);
    expect(loose({ type: "removeSchedule", id: "s1" })).toBe(true);
    expect(loose({ type: "setDailyLimit", domain: "youtube.com", value: 10 })).toBe(true);
    expect(loose({ type: "setSetting", key: "defaultDailyLimit", value: null })).toBe(true);
    expect(loose({ type: "setSetting", key: "baseWait", value: 5 })).toBe(true);
    expect(loose({ type: "setSetting", key: "maxWait", value: 60 })).toBe(true);
    expect(loose({ type: "setSetting", key: "cooldownMinutes", value: 5 })).toBe(true);
    expect(loose({ type: "setSetting", key: "unlockDurations", value: [5, 60] })).toBe(true);
    expect(loose({ type: "updateSchedule", schedule: { ...sched, end: "16:00" } })).toBe(true);
    expect(loose({ type: "pauseProtection", minutes: 15 })).toBe(true);
    expect(loose({ type: "pauseProtection", minutes: null })).toBe(true);
  });

  test("setDailyLimit back to default compares against the default", () => {
    const strict = makeState({ settings: { sites: [{ domain: "youtube.com", dailyLimit: 2 }] } });
    expect(loose({ type: "setDailyLimit", domain: "youtube.com", value: null }, strict)).toBe(true); // 2 -> 5
    const lax = makeState({ settings: { sites: [{ domain: "youtube.com", dailyLimit: 20 }] } });
    expect(loose({ type: "setDailyLimit", domain: "youtube.com", value: null }, lax)).toBe(false); // 20 -> 5
  });

  test("ending a running focus session is loosening", () => {
    const f = makeState({ runtime: { focus: { endsAt: MON + 10 * MIN } } });
    expect(loose({ type: "endFocus" }, f)).toBe(true);
  });

  test("shortening an existing pause is tightening, extending it is loosening", () => {
    const p = makeState({ runtime: { paused: { until: MON + 60 * MIN } } });
    expect(loose({ type: "pauseProtection", minutes: 15 }, p)).toBe(false);
    expect(loose({ type: "pauseProtection", minutes: 120 }, p)).toBe(true);
    expect(loose({ type: "pauseProtection", minutes: null }, p)).toBe(true);
  });
});

describe("applyOp", () => {
  test("addSite normalises and sorts; removeSite cleans unlocks and schedules", () => {
    let s = makeState({
      settings: { schedules: [sched] },
      runtime: { unlocks: { "youtube.com": MON + MIN } },
    });
    s = applyOp(s, { type: "addSite", domain: "https://www.Instagram.com/reels" }, MON);
    expect(s.settings.sites.map((x) => x.domain)).toEqual(["instagram.com", "reddit.com", "youtube.com"]);
    s = applyOp(s, { type: "removeSite", domain: "youtube.com" }, MON);
    expect(s.settings.sites.map((x) => x.domain)).toEqual(["instagram.com", "reddit.com"]);
    expect(s.runtime.unlocks).toEqual({});
    expect(s.settings.schedules).toEqual([]); // its only site was removed
  });

  test("does not mutate input", () => {
    const s = makeState();
    const before = JSON.stringify(s);
    applyOp(s, { type: "addSite", domain: "x.com" }, MON);
    expect(JSON.stringify(s)).toBe(before);
  });

  test("settings, focus and pause", () => {
    let s = makeState();
    s = applyOp(s, { type: "setSetting", key: "unlockDurations", value: [30, 5, 5, 10] }, MON);
    expect(s.settings.unlockDurations).toEqual([5, 10, 30]);
    s = applyOp(s, { type: "startFocus", minutes: 50 }, MON);
    s = applyOp(s, { type: "startFocus", minutes: 25 }, MON); // never shortens
    expect(s.runtime.focus.endsAt).toBe(MON + 50 * MIN);
    s = applyOp(s, { type: "pauseProtection", minutes: 15 }, MON);
    expect(s.runtime.paused).toEqual({ until: MON + 15 * MIN });
    s = applyOp(s, { type: "pauseProtection", minutes: null }, MON);
    expect(s.runtime.paused).toEqual({ until: null });
    s = applyOp(s, { type: "resumeProtection" }, MON);
    expect(s.runtime.paused).toBeNull();
  });

  test("schedules", () => {
    let s = applyOp(makeState(), { type: "addSchedule", schedule: sched }, MON);
    s = applyOp(s, { type: "updateSchedule", schedule: { ...sched, end: "18:00" } }, MON);
    expect(s.settings.schedules).toEqual([{ ...sched, end: "18:00" }]);
    s = applyOp(s, { type: "removeSchedule", id: "s1" }, MON);
    expect(s.settings.schedules).toEqual([]);
  });
});

describe("advance", () => {
  test("applies due pending ops at their due time and keeps future ones", () => {
    const s = makeState({
      runtime: {
        pending: [
          { id: "a", op: { type: "pauseProtection", minutes: 60 }, applyAt: MON - 10 * MIN },
          { id: "b", op: { type: "removeSite", domain: "reddit.com" }, applyAt: MON + 5 * MIN },
        ],
      },
    });
    const next = advance(s, MON);
    expect(next.runtime.paused).toEqual({ until: MON + 50 * MIN }); // started when it became due
    expect(next.runtime.pending.map((p) => p.id)).toEqual(["b"]);
    expect(next.settings.sites.map((x) => x.domain)).toContain("reddit.com");
  });

  test("a pending pause that would already be over is dropped entirely", () => {
    const s = makeState({
      runtime: { pending: [{ id: "a", op: { type: "pauseProtection", minutes: 15 }, applyAt: MON - 60 * MIN }] },
    });
    expect(advance(s, MON).runtime.paused).toBeNull();
  });

  test("expires unlocks, focus and pause; prunes stats", () => {
    const s = makeState({
      runtime: {
        unlocks: { "youtube.com": MON - 1, "reddit.com": MON + MIN },
        focus: { endsAt: MON },
        paused: { until: MON - 1 },
        pauseStarts: { "1:youtube.com": MON - 7 * 3600000, "2:reddit.com": MON - 1000 },
      },
      stats: { [dayKey(MON)]: { "youtube.com": 1 }, "2020-01-01": { "youtube.com": 9 } },
    });
    const next = advance(s, MON);
    expect(next.runtime.unlocks).toEqual({ "reddit.com": MON + MIN });
    expect(next.runtime.focus).toBeNull();
    expect(next.runtime.paused).toBeNull();
    expect(Object.keys(next.runtime.pauseStarts)).toEqual(["2:reddit.com"]);
    expect(Object.keys(next.stats)).toEqual([dayKey(MON)]);
  });

  test("skips pending ops that became invalid", () => {
    const s = makeState({
      runtime: { pending: [{ id: "a", op: { type: "removeSite", domain: "gone.com" }, applyAt: MON - 1 }] },
    });
    expect(() => advance(s, MON)).not.toThrow();
    expect(advance(s, MON).runtime.pending).toEqual([]);
  });
});

test("describeOp", () => {
  const s = makeState({ settings: { schedules: [sched] } });
  expect(describeOp({ type: "removeSite", domain: "youtube.com" }, s)).toBe("Remove youtube.com from your list");
  expect(describeOp({ type: "pauseProtection", minutes: null }, s)).toBe("Turn protection off");
  expect(describeOp({ type: "pauseProtection", minutes: 60 }, s)).toBe("Pause protection for 1 h");
  expect(describeOp({ type: "removeSchedule", id: "s1" }, s)).toBe(
    "Remove restricted hours: Weekdays 09:00–17:00, youtube.com"
  );
  expect(describeOp({ type: "setSetting", key: "cooldownMinutes", value: 5 }, s)).toBe(
    "Cooldown for loosening changes: 5 min"
  );
});
