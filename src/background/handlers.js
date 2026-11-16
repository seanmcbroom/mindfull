// Message handlers. Every state change goes through mutate() and is followed by reconcile().

const M = require("../shared/messages");
const { loadState, mutate } = require("./store");
const { reconcile, domainForUrl } = require("./reconcile");
const { siteStatus } = require("../shared/policy");
const { validateOp, isLoosening, applyOp, describeOp, advance } = require("../shared/ops");
const { isCommitPhrase, waitSeconds } = require("../shared/friction");
const { dayKey } = require("../shared/time");
const { DEV } = require("../shared/defaults");
const { usageToday } = require("../shared/usage");

const pauseKey = (sender, domain) => `${(sender.tab && sender.tab.id) || "x"}:${domain}`;

function allowedDurations(settings) {
  return DEV ? [1, ...settings.unlockDurations.filter((m) => m !== 1)] : settings.unlockDurations;
}

async function getState() {
  const now = Date.now();
  return { state: advance(await loadState(), now), now };
}

async function getSiteStatus({ url }) {
  const now = Date.now();
  const state = advance(await loadState(), now);
  const domain = domainForUrl(state, url);
  if (!domain) return { mode: "allowed", reason: "unlisted", domain: null, now };
  const status = siteStatus(state, domain, now);
  return {
    ...status,
    nextWaitSeconds: waitSeconds(status.unlocksToday + 1, state.settings),
    msToday: usageToday(state, domain, now),
    durations: allowedDurations(state.settings),
    now,
  };
}

async function beginPause({ domain }, sender) {
  const now = Date.now();
  const { result } = await mutate((draft) => {
    const state = advance(draft, now);
    const status = siteStatus(state, domain, now);
    if (status.mode !== "pause") return { state, result: { ok: false, status } };
    state.runtime.pauseStarts[pauseKey(sender, domain)] = now;
    return { state, result: { ok: true, waitSeconds: status.waitSeconds } };
  });
  return result;
}

async function requestUnlock({ domain, minutes }, sender) {
  const now = Date.now();
  const { result } = await mutate((draft) => {
    const state = advance(draft, now);
    const status = siteStatus(state, domain, now);
    if (status.mode !== "pause") return { state, result: { ok: false, error: "This site can't be unlocked right now." } };
    if (!allowedDurations(state.settings).includes(minutes)) {
      return { state, result: { ok: false, error: "That duration isn't available." } };
    }
    const key = pauseKey(sender, domain);
    const started = state.runtime.pauseStarts[key];
    // Small tolerance for timer jitter between page and worker.
    if (!started || now - started < status.waitSeconds * 1000 - 750) {
      return { state, result: { ok: false, error: "Finish the wait first." } };
    }
    delete state.runtime.pauseStarts[key];
    state.runtime.unlocks[domain] = now + minutes * 60000;
    const day = dayKey(now);
    state.stats[day] = { ...(state.stats[day] || {}), [domain]: status.unlocksToday + 1 };
    return { state, result: { ok: true, until: state.runtime.unlocks[domain] } };
  });
  if (result.ok) await reconcile(now);
  return result;
}

async function applyOpMsg({ op, phrase }) {
  const now = Date.now();
  const { result } = await mutate((draft) => {
    const state = advance(draft, now);
    const error = validateOp(op, state);
    if (error) return { state, result: { ok: false, error } };

    if (!isLoosening(op, state, now)) {
      return { state: applyOp(state, op, now), result: { ok: true, applied: true } };
    }
    if (!isCommitPhrase(phrase, op)) {
      return { state, result: { ok: false, error: "The phrase didn't match.", needsPhrase: true } };
    }
    const dupe = state.runtime.pending.find((p) => JSON.stringify(p.op) === JSON.stringify(op));
    if (dupe) return { state, result: { ok: true, pending: dupe } };

    const cooldown = state.settings.cooldownMinutes * 60000;
    if (cooldown === 0) return { state: applyOp(state, op, now), result: { ok: true, applied: true } };

    const entry = {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      op,
      label: describeOp(op, state),
      createdAt: now,
      applyAt: now + cooldown,
    };
    state.runtime.pending.push(entry);
    return { state, result: { ok: true, pending: entry } };
  });
  await reconcile(now);
  return result;
}

async function cancelPending({ id }) {
  await mutate((draft) => {
    draft.runtime.pending = draft.runtime.pending.filter((p) => p.id !== id);
  });
  await reconcile();
  return { ok: true };
}

const HANDLERS = {
  [M.GET_STATE]: getState,
  [M.GET_SITE_STATUS]: getSiteStatus,
  [M.BEGIN_PAUSE]: beginPause,
  [M.REQUEST_UNLOCK]: requestUnlock,
  [M.APPLY_OP]: applyOpMsg,
  [M.CANCEL_PENDING]: cancelPending,
};

async function handleMessage(msg, sender) {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return { ok: false, error: "Unknown message" };
  // Only our own extension pages may talk to the background.
  if (sender.id !== chrome.runtime.id) return { ok: false, error: "Forbidden" };
  return handler(msg, sender);
}

module.exports = { handleMessage };
