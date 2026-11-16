const { dayKey, nextDayStart, DAY_START_HOUR } = require("../src/shared/time");
const { at } = require("./helpers");

describe("the day starts at 04:00", () => {
  test("DAY_START_HOUR is 4", () => {
    expect(DAY_START_HOUR).toBe(4);
  });

  test("dayKey: anything before 04:00 still belongs to the previous day", () => {
    expect(dayKey(at(2026, 11, 16, 23, 0))).toBe("2026-11-16");
    expect(dayKey(at(2026, 11, 17, 0, 0))).toBe("2026-11-16");
    expect(dayKey(at(2026, 11, 17, 3, 59, 59))).toBe("2026-11-16");
    expect(dayKey(at(2026, 11, 17, 4, 0))).toBe("2026-11-17");
  });

  test("dayKey crosses month and year boundaries", () => {
    expect(dayKey(at(2026, 12, 1, 2, 0))).toBe("2026-11-30");
    expect(dayKey(at(2027, 1, 1, 3, 0))).toBe("2026-12-31");
  });

  test("nextDayStart: 04:00 today if it's still early, otherwise 04:00 tomorrow", () => {
    expect(nextDayStart(at(2026, 11, 17, 2, 0))).toBe(at(2026, 11, 17, 4, 0));
    expect(nextDayStart(at(2026, 11, 17, 4, 0))).toBe(at(2026, 11, 18, 4, 0));
    expect(nextDayStart(at(2026, 11, 16, 23, 30))).toBe(at(2026, 11, 17, 4, 0));
  });

  test("nextDayStart always lands on a different day than now", () => {
    for (let h = 0; h < 24; h++) {
      const now = at(2026, 11, 16, h, 30);
      const next = nextDayStart(now);
      expect(next).toBeGreaterThan(now);
      expect(dayKey(next)).not.toBe(dayKey(now));
      expect(dayKey(next - 1)).toBe(dayKey(now));
    }
  });
});
