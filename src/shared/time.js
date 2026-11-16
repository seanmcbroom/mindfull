// Local-time helpers. Everything takes an explicit `now` (ms) so it is testable.

const pad = (n) => String(n).padStart(2, "0");

/** A Mindfull "day" runs from 04:00 to 04:00 local, so a 1 am scroll counts toward the evening before. */
const DAY_START_HOUR = 4;

/** The day `now` belongs to, e.g. "2026-11-15" (03:59 on the 16th is still the 15th). */
function dayKey(now) {
  const d = new Date(now);
  // Step back a calendar day rather than 24 h of ms, so DST changes can't skip or repeat a day.
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Timestamp of the next 04:00 local, when daily counts reset. */
function nextDayStart(now) {
  const d = new Date(now);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** "09:30" -> 570, or null if malformed. */
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Local clock time "17:05". */
function fmtClock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Countdown "4:05" / "1:02:03" (never negative). */
function fmtCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Human duration in minutes: "45 min", "2 h", "1 h 30 min". */
function fmtMinutes(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

module.exports = { pad, DAY_START_HOUR, dayKey, nextDayStart, parseHM, fmtClock, fmtCountdown, fmtMinutes };
