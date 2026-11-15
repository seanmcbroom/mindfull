// Time spent on listed sites. The background keeps one open "segment" (the listed site in
// the focused window's active tab) and credits its time to usage[day][domain] whenever it
// changes or the 1-minute tick flushes it.

const { dayKey, fmtMinutes } = require("./time");

// Flushes happen at least every minute, so a longer gap means the browser was asleep or
// closed. Cap what a single flush can credit so that time isn't counted.
const MAX_SEGMENT_MS = 2 * 60 * 1000;

function segmentMs(active, now) {
  if (!active || now <= active.since) return 0;
  return Math.min(now - active.since, MAX_SEGMENT_MS);
}

/** Close the open segment (crediting its time to today) and open one for `domain`, or none. Pure. */
function trackUsage(state, domain, now) {
  const s = structuredClone(state);
  s.usage = s.usage || {};
  const ms = segmentMs(s.runtime.active, now);
  if (ms > 0) {
    const day = dayKey(now);
    const today = s.usage[day] || {};
    const d = s.runtime.active.domain;
    s.usage[day] = { ...today, [d]: (today[d] || 0) + ms };
  }
  s.runtime.active = domain ? { domain, since: now } : null;
  return s;
}

/** Milliseconds spent on `domain` today, including the segment that's open right now. */
function usageToday(state, domain, now) {
  const day = (state.usage || {})[dayKey(now)] || {};
  const active = state.runtime.active;
  const live = active && active.domain === domain ? segmentMs(active, now) : 0;
  return (day[domain] || 0) + live;
}

/** "under a minute", "12 min", "1 h 5 min" */
function fmtUsage(ms) {
  if (ms < 60000) return ms > 0 ? "under a minute" : "0 min";
  return fmtMinutes(Math.round(ms / 60000));
}

/** Short form for lists: "3 opens, 24 min today" / "not opened today". */
function todaySummary(opens, ms) {
  if (!opens && ms < 60000) return "not opened today";
  return `${opens} open${opens === 1 ? "" : "s"}, ${fmtUsage(ms)} today`;
}

module.exports = { MAX_SEGMENT_MS, trackUsage, usageToday, fmtUsage, todaySummary };
