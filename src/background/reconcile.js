// reconcile(): the idempotent heart of the background. Brings stored state forward to
// "now", then makes the browser match it: DNR rules, open tabs, alarms and the badge.
// Safe to call any number of times, from any event.

const { mutate } = require("./store");
const { advance } = require("../shared/ops");
const { buildRules, rulesSignature } = require("../shared/rules");
const { siteStatus, isFocusing, isPaused } = require("../shared/policy");
const { hostOf, matchSite } = require("../shared/domains");
const { trackUsage } = require("../shared/usage");

const PAUSE_PAGE = "src/pause.html";
const TICK = "tick";

function pauseUrl() {
  return chrome.runtime.getURL(PAUSE_PAGE);
}

async function syncRules(state, now) {
  const desired = buildRules(state, now, pauseUrl());
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (rulesSignature(existing) === rulesSignature(desired)) return;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: desired,
  });
}

function domainForUrl(state, url) {
  return matchSite(hostOf(url), state.settings.sites);
}

/**
 * Send open tabs on sites that are no longer allowed to the pause page; refresh per-tab badges.
 * `before` is the stored state prior to this reconcile, used to tell "your time ran out"
 * apart from "this site just became blocked".
 */
async function enforceTabs(state, before, now) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map(async (tab) => {
      const domain = domainForUrl(state, tab.url);
      const status = domain ? siteStatus(state, domain, now) : null;
      try {
        if (status && status.mode !== "allowed") {
          const hadUnlock = !!before.runtime.unlocks[domain];
          const reason = status.mode === "pause" && hadUnlock ? "expired" : "blocked";
          await chrome.tabs.update(tab.id, { url: `${pauseUrl()}?r=${reason}#${tab.url}` });
          return;
        }
        await setTabBadge(tab.id, status);
      } catch {
        // Tab closed or not editable; nothing to do.
      }
    })
  );
}

async function setTabBadge(tabId, status) {
  const text =
    status && status.reason === "unlocked" ? `${Math.max(1, Math.ceil((status.until - Date.now()) / 60000))}m` : null;
  await chrome.action.setBadgeText({ tabId, text });
}

async function updateGlobalBadge(state, now) {
  let text = "";
  if (isPaused(state.runtime, now)) text = "off";
  else if (isFocusing(state.runtime, now)) text = "F";
  await chrome.action.setBadgeText({ text });
}

/** One exact alarm per deadline, plus a 1-minute tick for schedule boundaries and the badge. */
async function syncAlarms(state) {
  const { runtime } = state;
  const want = new Map();
  for (const [domain, t] of Object.entries(runtime.unlocks)) want.set(`unlock:${domain}`, t);
  if (runtime.focus) want.set("focus", runtime.focus.endsAt);
  if (runtime.paused && runtime.paused.until !== null) want.set("paused", runtime.paused.until);
  for (const p of runtime.pending) want.set(`pending:${p.id}`, p.applyAt);

  const existing = await chrome.alarms.getAll();
  const byName = new Map(existing.map((a) => [a.name, a]));
  for (const a of existing) {
    if (a.name !== TICK && !want.has(a.name)) await chrome.alarms.clear(a.name);
  }
  for (const [name, when] of want) {
    const a = byName.get(name);
    if (!a || Math.abs(a.scheduledTime - when) > 1000) chrome.alarms.create(name, { when });
  }
  if (!byName.has(TICK)) chrome.alarms.create(TICK, { periodInMinutes: 1 });
}

/** The listed, currently-allowed site in the focused window's active tab, or null. */
async function domainInFront(state, now) {
  let win;
  try {
    win = await chrome.windows.getLastFocused();
  } catch {
    return null;
  }
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  const domain = tab && domainForUrl(state, tab.url);
  return domain && siteStatus(state, domain, now).mode === "allowed" ? domain : null;
}

/** Credit time to whichever listed site is in front, and start timing the current one. */
function trackActive(now = Date.now()) {
  return mutate(async (draft) => ({ state: trackUsage(draft, await domainInFront(draft, now), now) }));
}

let chain = Promise.resolve();

/** Serialised so overlapping events can't interleave rule updates. `now` may be pushed forward by alarms. */
function reconcile(now) {
  const run = chain.then(async () => {
    const t = Math.max(now || 0, Date.now());
    let before;
    const { state } = await mutate((draft) => {
      before = draft;
      return { state: advance(draft, t) };
    });
    await syncRules(state, t);
    await enforceTabs(state, before, t);
    await syncAlarms(state);
    await updateGlobalBadge(state, t);
    await trackActive(t);
    return state;
  });
  chain = run.catch((e) => console.error("[mindfull] reconcile failed", e));
  return run;
}

module.exports = { reconcile, trackActive, setTabBadge, domainForUrl, pauseUrl };
