// The single decision function: what happens when the user opens a listed site right now.

const { dayKey, nextMidnight } = require("./time");
const { activeRestriction } = require("./schedule");
const { waitSeconds } = require("./friction");

/** Effective daily unlock limit for a site (null = unlimited). */
function effectiveLimit(settings, domain) {
  const site = settings.sites.find((s) => s.domain === domain);
  if (site && site.dailyLimit !== null && site.dailyLimit !== undefined) return site.dailyLimit;
  return settings.defaultDailyLimit;
}

/** Numeric form of a limit for comparisons (null = unlimited = Infinity). */
function limitValue(limit) {
  return limit === null || limit === undefined ? Infinity : limit;
}

function isPaused(runtime, now) {
  return !!runtime.paused && (runtime.paused.until === null || runtime.paused.until > now);
}

function isFocusing(runtime, now) {
  return !!runtime.focus && runtime.focus.endsAt > now;
}

function unlocksToday(stats, domain, now) {
  const day = stats && stats[dayKey(now)];
  return (day && day[domain]) || 0;
}

/**
 * Decide what opening `domain` means at `now`.
 * mode: "allowed" | "pause" (wait, then Enter is possible) | "hardblock" (Leave only)
 * reason: unlisted | paused | unlocked | focus | schedule | limit | null
 * Precedence: protection paused > focus > restricted hours > active unlock > daily limit > pause.
 */
function siteStatus(state, domain, now) {
  const { settings, runtime, stats } = state;
  const count = unlocksToday(stats, domain, now);
  const limit = effectiveLimit(settings, domain);
  const base = {
    domain,
    unlocksToday: count,
    limit,
    waitSeconds: waitSeconds(count, settings),
    until: null,
    reason: null,
  };

  if (!settings.sites.some((s) => s.domain === domain)) return { ...base, mode: "allowed", reason: "unlisted" };
  if (isPaused(runtime, now)) return { ...base, mode: "allowed", reason: "paused", until: runtime.paused.until };
  if (isFocusing(runtime, now)) return { ...base, mode: "hardblock", reason: "focus", until: runtime.focus.endsAt };

  const restrictedUntil = activeRestriction(settings.schedules, domain, now);
  if (restrictedUntil !== null) return { ...base, mode: "hardblock", reason: "schedule", until: restrictedUntil };

  const unlockedUntil = runtime.unlocks[domain];
  if (unlockedUntil && unlockedUntil > now) return { ...base, mode: "allowed", reason: "unlocked", until: unlockedUntil };

  if (count >= limitValue(limit)) return { ...base, mode: "hardblock", reason: "limit", until: nextMidnight(now) };

  return { ...base, mode: "pause" };
}

module.exports = { effectiveLimit, limitValue, isPaused, isFocusing, unlocksToday, siteStatus };
