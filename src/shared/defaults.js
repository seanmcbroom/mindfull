// Canonical defaults. Add new settings keys here (and to ops.js SETTING_RULES
// so changes to them get classified as tightening/loosening).

/* global __DEV__ */
const DEV = typeof __DEV__ !== "undefined" && __DEV__ === true;

const DEFAULT_SETTINGS = {
  sites: [],                // [{ domain, dailyLimit: null | integer >= 0 }] (null = use default)
  defaultDailyLimit: 5,     // null = no limit
  schedules: [],            // [{ id, days: [0-6], start: "HH:MM", end: "HH:MM", sites: "all" | [domain] }]
  baseWait: 10,             // seconds to wait before the first Enter on a site each day (resets at 04:00)
  maxWait: 120,             // cap for the escalating wait
  cooldownMinutes: 10,      // delay before a loosening change takes effect
  unlockDurations: [5, 10, 15, 30], // minutes offered after "Enter"
};

const DEFAULT_RUNTIME = {
  unlocks: {},      // { [domain]: expiresAt }
  focus: null,      // { endsAt }
  paused: null,     // { until: number | null }  (null until = turned off)
  pending: [],      // [{ id, op, applyAt, createdAt }]
  pauseStarts: {},  // { ["<tabId>:<domain>"]: startedAt }
  active: null,     // { domain, since }: listed site currently in front, for time tracking
};

// Option lists shown in the UI. DEV builds add 1-minute entries for testing.
const DEV_MINUTE = DEV ? [1] : [];
const CHOICES = {
  unlockDurations: [...DEV_MINUTE, 5, 10, 15, 20, 30, 45, 60],
  focusMinutes: [...DEV_MINUTE, 25, 50, 90],
  cooldownMinutes: [...DEV_MINUTE, 5, 10, 15, 30, 60, 120],
  baseWait: [5, 10, 15, 20, 30, 60],
  maxWait: [30, 60, 120, 180, 300],
  dailyLimit: [0, 1, 2, 3, 5, 10, 20, 50],
  pauseMinutes: [15, 60, 240],
};

const COMMIT_PHRASES = [
  "I am choosing to spend my attention here on purpose",
  "This is my time and I am deciding how to use it",
  "I have thought about this and I still want it",
  "My attention is worth protecting and I choose this anyway",
  "I am not on autopilot right now",
];

// Typed to confirm removing a site. {site} is replaced with the domain, so the person has
// to name exactly what they're letting back in. The background checks against this list.
const REMOVE_SITE_PHRASES = [
  "I want {site} to open without asking",
  "I trust myself with {site} now",
  "{site} does not need a pause anymore",
  "I am removing {site} on purpose",
  "I have thought about this and {site} can go",
  "I will not miss the pause on {site}",
  "Removing {site} is a decision not a reflex",
  "I know how much time {site} takes",
  "I am fine with {site} opening straight away",
  "This is not an impulse and {site} can come off the list",
  "Future me is okay with {site} coming off the list",
  "I am sure about letting {site} back in",
];

// Headings for the pause page. One is picked at random per visit (never the same twice
// in a row). Short, plain, no lecturing, no trailing period.
const IMPULSE_PHRASES = [
  "This may be an impulse",
  "Did you mean to come here?",
  "Is this on purpose?",
  "Was that a reflex?",
  "What were you about to do?",
  "Still want to go in?",
  "Is now the time?",
  "Do you need this right now?",
  "Just checking in",
  "Take a second",
  "Could this wait?",
  "What are you looking for?",
  "Hands faster than your head?",
  "You might not need this",
  "Habit or choice?",
  "Is there something else you meant to do?",
];

const SUGGESTED_SITES = [
  "youtube.com",
  "tiktok.com",
  "instagram.com",
  "x.com",
  "reddit.com",
  "facebook.com",
  "twitch.tv",
  "netflix.com",
];

module.exports = {
  DEV,
  DEFAULT_SETTINGS,
  DEFAULT_RUNTIME,
  CHOICES,
  COMMIT_PHRASES,
  REMOVE_SITE_PHRASES,
  IMPULSE_PHRASES,
  SUGGESTED_SITES,
};
