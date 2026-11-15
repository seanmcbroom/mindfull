const { trackUsage, usageToday, fmtUsage, todaySummary, MAX_SEGMENT_MS } = require("../src/shared/usage");
const { advance } = require("../src/shared/ops");
const { dayKey } = require("../src/shared/time");
const { at, MON, makeState } = require("./helpers");

const MIN = 60000;
const today = dayKey(MON);

describe("trackUsage", () => {
  test("opens a segment, then credits it on the next flush", () => {
    let s = trackUsage(makeState(), "youtube.com", MON);
    expect(s.runtime.active).toEqual({ domain: "youtube.com", since: MON });
    expect(s.usage).toEqual({});

    s = trackUsage(s, "youtube.com", MON + MIN); // tick flush, still there
    expect(s.usage[today]["youtube.com"]).toBe(MIN);
    expect(s.runtime.active).toEqual({ domain: "youtube.com", since: MON + MIN });

    s = trackUsage(s, null, MON + MIN + 30000); // switched away
    expect(s.usage[today]["youtube.com"]).toBe(MIN + 30000);
    expect(s.runtime.active).toBeNull();
  });

  test("switching sites credits the previous one", () => {
    let s = trackUsage(makeState(), "youtube.com", MON);
    s = trackUsage(s, "reddit.com", MON + 20000);
    expect(s.usage[today]).toEqual({ "youtube.com": 20000 });
    expect(s.runtime.active.domain).toBe("reddit.com");
  });

  test("caps a single flush so sleep or a closed browser isn't counted", () => {
    let s = trackUsage(makeState(), "youtube.com", MON);
    s = trackUsage(s, null, MON + 3 * 3600000);
    expect(s.usage[today]["youtube.com"]).toBe(MAX_SEGMENT_MS);
  });

  test("ignores clock going backwards and does not mutate input", () => {
    const start = trackUsage(makeState(), "youtube.com", MON);
    const before = JSON.stringify(start);
    const s = trackUsage(start, null, MON - 5000);
    expect(s.usage).toEqual({});
    expect(JSON.stringify(start)).toBe(before);
  });
});

describe("usageToday", () => {
  test("adds the live segment for that site only", () => {
    const s = makeState({
      usage: { [today]: { "youtube.com": 5 * MIN } },
      runtime: { active: { domain: "youtube.com", since: MON - MIN } },
    });
    expect(usageToday(s, "youtube.com", MON)).toBe(6 * MIN);
    expect(usageToday(s, "reddit.com", MON)).toBe(0);
    expect(usageToday(s, "youtube.com", at(2026, 11, 17, 10))).toBe(MAX_SEGMENT_MS); // new day, only the (capped) live part
  });
});

test("advance prunes old usage", () => {
  const s = makeState({ usage: { [today]: { "youtube.com": MIN }, "2020-01-01": { "youtube.com": MIN } } });
  expect(Object.keys(advance(s, MON).usage)).toEqual([today]);
});

test("formatting", () => {
  expect(fmtUsage(0)).toBe("0 min");
  expect(fmtUsage(20000)).toBe("under a minute");
  expect(fmtUsage(24 * MIN + 10000)).toBe("24 min");
  expect(fmtUsage(65 * MIN)).toBe("1 h 5 min");
  expect(todaySummary(0, 0)).toBe("not opened today");
  expect(todaySummary(1, 90000)).toBe("1 open, 2 min today");
  expect(todaySummary(3, 24 * MIN)).toBe("3 opens, 24 min today");
});
