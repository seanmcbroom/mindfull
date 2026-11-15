const {
  isScheduleActive,
  activeUntil,
  activeRestriction,
  scheduleContains,
  validateSchedule,
  describeSchedule,
} = require("../src/shared/schedule");
const { at } = require("./helpers");

const weekdays = { id: "w", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", sites: "all" };
const fridayNight = { id: "n", days: [5], start: "22:00", end: "02:00", sites: ["youtube.com"] };

test("fixture sanity: 16 Nov 2026 is a Monday", () => {
  expect(new Date(at(2026, 11, 16)).getDay()).toBe(1);
});

describe("isScheduleActive", () => {
  test("daytime window", () => {
    expect(isScheduleActive(weekdays, at(2026, 11, 16, 10, 0))).toBe(true);
    expect(isScheduleActive(weekdays, at(2026, 11, 16, 9, 0))).toBe(true);
    expect(isScheduleActive(weekdays, at(2026, 11, 16, 8, 59))).toBe(false);
    expect(isScheduleActive(weekdays, at(2026, 11, 16, 17, 0))).toBe(false);
    expect(isScheduleActive(weekdays, at(2026, 11, 21, 10, 0))).toBe(false); // Saturday
  });

  test("overnight window belongs to its start day", () => {
    expect(isScheduleActive(fridayNight, at(2026, 11, 20, 21, 59))).toBe(false); // Fri
    expect(isScheduleActive(fridayNight, at(2026, 11, 20, 23, 0))).toBe(true); // Fri
    expect(isScheduleActive(fridayNight, at(2026, 11, 21, 1, 59))).toBe(true); // Sat early
    expect(isScheduleActive(fridayNight, at(2026, 11, 21, 2, 0))).toBe(false);
    expect(isScheduleActive(fridayNight, at(2026, 11, 21, 23, 0))).toBe(false); // Sat night
    expect(isScheduleActive(fridayNight, at(2026, 11, 20, 1, 0))).toBe(false); // Fri early (Thu not listed)
  });

  test("start === end means a full day", () => {
    const allDay = { id: "a", days: [0], start: "00:00", end: "00:00", sites: "all" };
    expect(isScheduleActive(allDay, at(2026, 11, 15, 0, 0))).toBe(true); // Sun
    expect(isScheduleActive(allDay, at(2026, 11, 15, 23, 59))).toBe(true);
    expect(isScheduleActive(allDay, at(2026, 11, 16, 0, 0))).toBe(false); // Mon
  });
});

describe("activeUntil / activeRestriction", () => {
  test("end of current window", () => {
    expect(activeUntil(weekdays, at(2026, 11, 16, 10, 0))).toBe(at(2026, 11, 16, 17, 0));
    expect(activeUntil(fridayNight, at(2026, 11, 20, 23, 0))).toBe(at(2026, 11, 21, 2, 0));
    expect(activeUntil(weekdays, at(2026, 11, 21, 10, 0))).toBeNull();
  });

  test("respects site lists", () => {
    const now = at(2026, 11, 20, 23, 0);
    expect(activeRestriction([fridayNight], "youtube.com", now)).toBe(at(2026, 11, 21, 2, 0));
    expect(activeRestriction([fridayNight], "reddit.com", now)).toBeNull();
  });

  test("follows back-to-back windows", () => {
    const morning = { id: "m", days: [1], start: "09:00", end: "12:00", sites: "all" };
    const afternoon = { id: "p", days: [1], start: "12:00", end: "17:00", sites: "all" };
    expect(activeRestriction([morning, afternoon], "x.com", at(2026, 11, 16, 10, 0))).toBe(at(2026, 11, 16, 17, 0));
  });
});

describe("scheduleContains", () => {
  test("wider times contain narrower ones", () => {
    const wider = { ...weekdays, start: "08:00", end: "18:00" };
    expect(scheduleContains(wider, weekdays)).toBe(true);
    expect(scheduleContains(weekdays, wider)).toBe(false);
  });

  test("dropping a day is not containment", () => {
    expect(scheduleContains({ ...weekdays, days: [1, 2, 3, 4] }, weekdays)).toBe(false);
    expect(scheduleContains({ ...weekdays, days: [0, 1, 2, 3, 4, 5, 6] }, weekdays)).toBe(true);
  });

  test("site lists", () => {
    const yt = { ...weekdays, sites: ["youtube.com"] };
    const ytReddit = { ...weekdays, sites: ["youtube.com", "reddit.com"] };
    expect(scheduleContains(weekdays, yt)).toBe(true); // all ⊇ list
    expect(scheduleContains(yt, weekdays)).toBe(false); // list ⊉ all
    expect(scheduleContains(ytReddit, yt)).toBe(true);
    expect(scheduleContains(yt, ytReddit)).toBe(false);
  });

  test("overnight extension", () => {
    expect(scheduleContains({ ...fridayNight, end: "03:00" }, fridayNight)).toBe(true);
    expect(scheduleContains({ ...fridayNight, start: "23:00" }, fridayNight)).toBe(false);
  });
});

describe("validateSchedule / describeSchedule", () => {
  test("validation", () => {
    expect(validateSchedule(weekdays)).toBeNull();
    expect(validateSchedule({ ...weekdays, days: [] })).toMatch(/day/);
    expect(validateSchedule({ ...weekdays, start: "25:00" })).toMatch(/time/);
    expect(validateSchedule({ ...weekdays, sites: [] })).toMatch(/site/);
  });

  test("description", () => {
    expect(describeSchedule(weekdays)).toBe("Weekdays 09:00–17:00 · all sites");
    expect(describeSchedule(fridayNight)).toBe("Fri 22:00–02:00 · youtube.com");
  });
});
