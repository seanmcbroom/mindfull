// Restricted-hours schedules: { id, days: [0-6] (0 = Sunday), start: "HH:MM", end: "HH:MM", sites: "all" | [domain] }
// A window starts on each listed day at `start` and lasts until `end`; if end <= start it runs
// overnight into the next day (start === end means a full 24 hours).

const { parseHM } = require("./time");

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function windowLength(s) {
  const st = parseHM(s.start);
  const en = parseHM(s.end);
  if (st === null || en === null) return 0;
  return en > st ? en - st : en + DAY_MIN - st;
}

/** If schedule s is active at `now`, the local midnight timestamp of the day its window started; else null. */
function activeWindowDay(s, now) {
  const st = parseHM(s.start);
  const len = windowLength(s);
  if (st === null || len === 0 || !Array.isArray(s.days)) return null;
  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  for (const back of [0, 1]) {
    const day = (d.getDay() - back + 7) % 7;
    if (!s.days.includes(day)) continue;
    const offset = minutes + back * DAY_MIN - st;
    if (offset >= 0 && offset < len) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
    }
  }
  return null;
}

function isScheduleActive(s, now) {
  return activeWindowDay(s, now) !== null;
}

/** End timestamp of the currently active window of s (null if inactive). */
function activeUntil(s, now) {
  const dayStart = activeWindowDay(s, now);
  if (dayStart === null) return null;
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, parseHM(s.start) + windowLength(s)).getTime();
}

function scheduleCovers(s, domain) {
  return s.sites === "all" || (Array.isArray(s.sites) && s.sites.includes(domain));
}

/**
 * If any schedule restricts `domain` at `now`, the time the restriction lifts
 * (following back-to-back windows); otherwise null.
 */
function activeRestriction(schedules, domain, now) {
  const relevant = (schedules || []).filter((s) => scheduleCovers(s, domain));
  let until = null;
  let t = now;
  for (let i = 0; i < 16; i++) {
    let next = null;
    for (const s of relevant) {
      const end = activeUntil(s, t);
      if (end !== null && (next === null || end > next)) next = end;
    }
    if (next === null || next <= t) break;
    until = next;
    t = next;
  }
  return until;
}

/** Minute-of-week coverage bitmap (index 0 = Sunday 00:00). */
function weekCoverage(s) {
  const out = new Uint8Array(WEEK_MIN);
  const st = parseHM(s.start);
  const len = windowLength(s);
  if (st === null || !Array.isArray(s.days)) return out;
  for (const day of s.days) {
    for (let i = 0; i < len; i++) out[(day * DAY_MIN + st + i) % WEEK_MIN] = 1;
  }
  return out;
}

/** True if schedule `b` restricts at least everything `a` restricts (times and sites). */
function scheduleContains(b, a) {
  const ca = weekCoverage(a);
  const cb = weekCoverage(b);
  for (let i = 0; i < WEEK_MIN; i++) if (ca[i] && !cb[i]) return false;
  if (b.sites === "all") return true;
  if (a.sites === "all") return false;
  return a.sites.every((d) => b.sites.includes(d));
}

function validateSchedule(s) {
  if (!s || typeof s !== "object") return "Invalid schedule";
  if (typeof s.id !== "string" || !s.id) return "Schedule needs an id";
  if (!Array.isArray(s.days) || s.days.length === 0) return "Pick at least one day";
  if (!s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return "Invalid day";
  if (parseHM(s.start) === null || parseHM(s.end) === null) return "Invalid time";
  if (s.sites !== "all" && !(Array.isArray(s.sites) && s.sites.length > 0 && s.sites.every((d) => typeof d === "string"))) {
    return "Pick at least one site";
  }
  return null;
}

/** "Mon–Fri 09:00–17:00 · all sites" */
function describeSchedule(s) {
  const days = [...s.days].sort((a, b) => a - b);
  let dayText;
  if (days.length === 7) dayText = "Every day";
  else if (days.join() === "1,2,3,4,5") dayText = "Weekdays";
  else if (days.join() === "0,6") dayText = "Weekends";
  else dayText = days.map((d) => DAY_NAMES[d]).join(", ");
  const sites = s.sites === "all" ? "all sites" : s.sites.join(", ");
  return `${dayText} ${s.start}–${s.end} · ${sites}`;
}

module.exports = {
  DAY_NAMES,
  isScheduleActive,
  activeUntil,
  scheduleCovers,
  activeRestriction,
  scheduleContains,
  validateSchedule,
  describeSchedule,
};
