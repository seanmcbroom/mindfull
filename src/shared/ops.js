// Every change to settings/protection is a discrete "op". Ops are classified as
// tightening (applied instantly) or loosening (commit phrase + cooldown). This module
// is the single source of truth for that classification, used by both UI and background.

const { normalizeDomain, coversHost } = require("./domains");
const { scheduleContains, validateSchedule, describeSchedule } = require("./schedule");
const { effectiveLimit, limitValue, isPaused, isFocusing } = require("./policy");
const { dayKey, fmtMinutes } = require("./time");

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

const SETTING_RULES = {
  defaultDailyLimit: {
    valid: (v) => v === null || isInt(v, 0, 1000),
    loosens: (o, n) => limitValue(n) > limitValue(o),
    label: (v) => `Default daily opens: ${v === null ? "no limit" : v}`,
  },
  baseWait: {
    valid: (v) => isInt(v, 0, 3600),
    loosens: (o, n) => n < o,
    label: (v) => `First wait: ${v}s`,
  },
  maxWait: {
    valid: (v) => isInt(v, 0, 3600),
    loosens: (o, n) => n < o,
    label: (v) => `Longest wait: ${v}s`,
  },
  cooldownMinutes: {
    valid: (v) => isInt(v, 0, 1440),
    loosens: (o, n) => n < o,
    label: (v) => `Cooldown for loosening changes: ${fmtMinutes(v)}`,
  },
  unlockDurations: {
    valid: (v) => Array.isArray(v) && v.length > 0 && v.length <= 12 && v.every((x) => isInt(x, 1, 240)),
    loosens: (o, n) => Math.max(...n) > Math.max(...o),
    label: (v) => `Time options when entering: ${v.join(", ")} min`,
  },
};

/** Returns an error string, or null if the op is well-formed for this state. */
function validateOp(op, state) {
  if (!op || typeof op.type !== "string") return "Invalid change";
  const { settings } = state;
  switch (op.type) {
    case "addSite": {
      const d = normalizeDomain(op.domain);
      if (!d) return "That doesn't look like a website address";
      const parent = settings.sites.find((s) => coversHost(s.domain, d));
      if (parent) return parent.domain === d ? `${d} is already on your list` : `Already covered by ${parent.domain}`;
      return null;
    }
    case "removeSite":
      return settings.sites.some((s) => s.domain === op.domain) ? null : "That site isn't on your list";
    case "setDailyLimit":
      if (!settings.sites.some((s) => s.domain === op.domain)) return "That site isn't on your list";
      return op.value === null || isInt(op.value, 0, 1000) ? null : "Invalid limit";
    case "addSchedule":
    case "updateSchedule": {
      const err = validateSchedule(op.schedule);
      if (err) return err;
      const exists = settings.schedules.some((s) => s.id === op.schedule.id);
      if (op.type === "addSchedule" && exists) return "Schedule already exists";
      if (op.type === "updateSchedule" && !exists) return "Schedule not found";
      return null;
    }
    case "removeSchedule":
      return settings.schedules.some((s) => s.id === op.id) ? null : "Schedule not found";
    case "setSetting": {
      const rule = SETTING_RULES[op.key];
      if (!rule) return "Unknown setting";
      return rule.valid(op.value) ? null : "Invalid value";
    }
    case "pauseProtection":
      return op.minutes === null || isInt(op.minutes, 1, 7 * 1440) ? null : "Invalid duration";
    case "startFocus":
      return isInt(op.minutes, 1, 600) ? null : "Invalid duration";
    case "resumeProtection":
    case "endFocus":
      return null;
    default:
      return "Unknown change";
  }
}

/** True if applying op would give the user more access than they have now. */
function isLoosening(op, state, now) {
  const { settings, runtime } = state;
  switch (op.type) {
    case "addSite":
    case "addSchedule":
    case "startFocus":
    case "resumeProtection":
      return false;
    case "removeSite":
    case "removeSchedule":
      return true;
    case "setDailyLimit": {
      const before = effectiveLimit(settings, op.domain);
      const after = op.value === null ? settings.defaultDailyLimit : op.value;
      return limitValue(after) > limitValue(before);
    }
    case "updateSchedule": {
      const existing = settings.schedules.find((s) => s.id === op.schedule.id);
      return !existing || !scheduleContains(op.schedule, existing);
    }
    case "setSetting": {
      const rule = SETTING_RULES[op.key];
      return !!rule && rule.loosens(settings[op.key], op.value);
    }
    case "pauseProtection": {
      if (!isPaused(runtime, now)) return true;
      const current = runtime.paused.until === null ? Infinity : runtime.paused.until;
      const next = op.minutes === null ? Infinity : now + op.minutes * 60000;
      return next > current;
    }
    case "endFocus":
      return isFocusing(runtime, now);
    default:
      return true;
  }
}

/** Pure reducer: returns a new state with op applied at time `now`. Tolerates stale ops (no-op). */
function applyOp(state, op, now) {
  const s = structuredClone(state);
  const { settings, runtime } = s;
  switch (op.type) {
    case "addSite": {
      const d = normalizeDomain(op.domain);
      if (!d || settings.sites.some((x) => coversHost(x.domain, d))) break;
      settings.sites.push({ domain: d, dailyLimit: null });
      settings.sites.sort((a, b) => a.domain.localeCompare(b.domain));
      break;
    }
    case "removeSite": {
      settings.sites = settings.sites.filter((x) => x.domain !== op.domain);
      delete runtime.unlocks[op.domain];
      settings.schedules = settings.schedules
        .map((sch) => (Array.isArray(sch.sites) ? { ...sch, sites: sch.sites.filter((d) => d !== op.domain) } : sch))
        .filter((sch) => sch.sites === "all" || sch.sites.length > 0);
      break;
    }
    case "setDailyLimit": {
      const site = settings.sites.find((x) => x.domain === op.domain);
      if (site) site.dailyLimit = op.value;
      break;
    }
    case "addSchedule":
      if (!settings.schedules.some((x) => x.id === op.schedule.id)) settings.schedules.push(structuredClone(op.schedule));
      break;
    case "updateSchedule":
      settings.schedules = settings.schedules.map((x) => (x.id === op.schedule.id ? structuredClone(op.schedule) : x));
      break;
    case "removeSchedule":
      settings.schedules = settings.schedules.filter((x) => x.id !== op.id);
      break;
    case "setSetting":
      settings[op.key] =
        op.key === "unlockDurations" ? [...new Set(op.value)].sort((a, b) => a - b) : op.value;
      break;
    case "pauseProtection":
      runtime.paused = { until: op.minutes === null ? null : now + op.minutes * 60000 };
      break;
    case "resumeProtection":
      runtime.paused = null;
      break;
    case "startFocus": {
      const endsAt = now + op.minutes * 60000;
      runtime.focus = { endsAt: Math.max(endsAt, (runtime.focus && runtime.focus.endsAt) || 0) };
      break;
    }
    case "endFocus":
      runtime.focus = null;
      break;
  }
  return s;
}

/** Human-readable summary of an op (for the pending-changes list). */
function describeOp(op, state) {
  switch (op.type) {
    case "addSite":
      return `Block ${op.domain}`;
    case "removeSite":
      return `Remove ${op.domain} from your list`;
    case "setDailyLimit":
      return `Daily opens for ${op.domain}: ${op.value === null ? "use default" : op.value}`;
    case "addSchedule":
      return `Add restricted hours: ${describeSchedule(op.schedule)}`;
    case "updateSchedule":
      return `Change restricted hours to ${describeSchedule(op.schedule)}`;
    case "removeSchedule": {
      const existing = state && state.settings.schedules.find((s) => s.id === op.id);
      return existing ? `Remove restricted hours: ${describeSchedule(existing)}` : "Remove restricted hours";
    }
    case "setSetting":
      return SETTING_RULES[op.key] ? SETTING_RULES[op.key].label(op.value) : "Change a setting";
    case "pauseProtection":
      return op.minutes === null ? "Turn protection off" : `Pause protection for ${fmtMinutes(op.minutes)}`;
    case "resumeProtection":
      return "Resume protection";
    case "startFocus":
      return `Focus for ${fmtMinutes(op.minutes)}`;
    case "endFocus":
      return "End the focus session early";
    default:
      return "Change";
  }
}

const PAUSE_START_TTL = 6 * 3600 * 1000;
const STATS_DAYS = 7;

/**
 * Move state forward to `now`: apply due pending ops (at their due time), then drop
 * expired unlocks / focus / pause, stale pause timers and old stats. Pure.
 */
function advance(state, now) {
  let s = structuredClone(state);
  const due = s.runtime.pending.filter((p) => p.applyAt <= now).sort((a, b) => a.applyAt - b.applyAt);
  if (due.length) {
    s.runtime.pending = s.runtime.pending.filter((p) => p.applyAt > now);
    for (const p of due) {
      if (!validateOp(p.op, s)) s = applyOp(s, p.op, p.applyAt);
    }
  }
  const { runtime } = s;
  for (const [d, t] of Object.entries(runtime.unlocks)) if (t <= now) delete runtime.unlocks[d];
  if (runtime.focus && runtime.focus.endsAt <= now) runtime.focus = null;
  if (runtime.paused && runtime.paused.until !== null && runtime.paused.until <= now) runtime.paused = null;
  for (const [k, t] of Object.entries(runtime.pauseStarts)) if (now - t > PAUSE_START_TTL) delete runtime.pauseStarts[k];

  const oldest = dayKey(now - (STATS_DAYS - 1) * 86400000);
  for (const k of Object.keys(s.stats)) if (k < oldest) delete s.stats[k];
  for (const k of Object.keys(s.usage || {})) if (k < oldest) delete s.usage[k];
  return s;
}

module.exports = { SETTING_RULES, validateOp, isLoosening, applyOp, describeOp, advance };
