// Toolbar popup: what's happening now, the current site, focus sessions, pending changes.

const M = require("../shared/messages");
const { send, esc, $, startTicker, tickCountdowns, onStateChange, onMidnight, toast, submitOp } = require("../shared/ui");
const { hostOf, matchSite, normalizeDomain } = require("../shared/domains");
const { siteStatus, isPaused, isFocusing } = require("../shared/policy");
const { describeOp } = require("../shared/ops");
const { fmtClock, fmtMinutes } = require("../shared/time");
const { CHOICES } = require("../shared/defaults");
const { usageToday, todaySummary } = require("../shared/usage");

const app = $("#app");
let ctx = null; // { state, now }
let activeUrl = null;

function renderStatus(state, now) {
  const el = $("#status-pill");
  if (isPaused(state.runtime, now)) {
    const until = state.runtime.paused.until;
    el.className = "g-status off";
    el.textContent = until === null ? "Off" : `Paused until ${fmtClock(until)}`;
  } else if (isFocusing(state.runtime, now)) {
    el.className = "g-status focus";
    el.textContent = "Focusing";
  } else {
    const n = state.settings.sites.length;
    el.className = "g-status";
    el.textContent = `Guarding ${n} site${n === 1 ? "" : "s"}`;
  }
}

const section = (heading, body) => `<section class="g-section"><h2 class="g-h">${heading}</h2>${body}</section>`;

function currentSiteSection(state, now) {
  const host = hostOf(activeUrl);
  if (!host) return "";
  const domain = matchSite(host, state.settings.sites);
  if (!domain) {
    const candidate = normalizeDomain(host);
    if (!candidate) return "";
    return section(
      "This site",
      `<div class="g-row"><b class="grow">${esc(candidate)}</b>
        <button class="btn btn-sm" data-act="block" data-domain="${esc(candidate)}">Ask me first</button></div>`
    );
  }
  const st = siteStatus(state, domain, now);
  let state_;
  if (st.reason === "unlocked") state_ = `open for <span class="tabular" data-until="${st.until}"></span>`;
  else if (st.reason === "paused") state_ = "protection paused";
  else if (st.mode === "hardblock") state_ = "closed";
  else state_ = todaySummary(st.unlocksToday, usageToday(state, domain, now));
  return section("This site", `<div class="g-row"><b class="grow">${esc(domain)}</b><em>${state_}</em></div>`);
}

function focusSection(state, now) {
  if (isFocusing(state.runtime, now)) {
    return section(
      "Focus session",
      `<div class="g-row"><span class="grow g-big" data-until="${state.runtime.focus.endsAt}"></span>
        <button class="btn btn-sm" data-act="end-focus">End early</button></div>
       <p class="g-note">All your sites stay closed until it ends.</p>`
    );
  }
  return section(
    "Focus for",
    `<div class="chips">${CHOICES.focusMinutes
      .map((m) => `<button class="chip" data-act="focus" data-min="${m}">${esc(fmtMinutes(m))}</button>`)
      .join("")}</div>`
  );
}

function unlocksSection(state, now) {
  const items = Object.entries(state.runtime.unlocks).filter(([, t]) => t > now);
  if (!items.length) return "";
  return section(
    "Open right now",
    items
      .map(([d, t]) => `<div class="g-row"><span class="grow">${esc(d)}</span><em class="tabular" data-until="${t}"></em></div>`)
      .join("")
  );
}

function pendingSection(state) {
  const items = state.runtime.pending;
  if (!items.length) return "";
  return section(
    "Waiting to apply",
    items
      .map((p) => {
        const label = esc(p.label || describeOp(p.op, state));
        return `<div class="g-row">
          <span class="grow" title="${label}">${label}</span>
          <em class="tabular" data-until="${p.applyAt}"></em>
          <button class="link-btn" data-act="cancel" data-id="${esc(p.id)}">Cancel</button>
        </div>`;
      })
      .join("")
  );
}

function pausedSection(state, now) {
  if (!isPaused(state.runtime, now)) return "";
  return `<div class="g-row"><span class="grow">Sites open without asking.</span>
    <button class="btn btn-sm btn-primary" data-act="resume">Resume</button></div>`;
}

function emptyHint(state) {
  if (state.settings.sites.length) return "";
  return `<p class="g-note">No sites yet. Open a site you visit without thinking and choose "Ask me first", or add sites in Settings.</p>`;
}

function render() {
  const { state } = ctx;
  const now = Date.now();
  renderStatus(state, now);
  app.innerHTML =
    pausedSection(state, now) +
    emptyHint(state) +
    currentSiteSection(state, now) +
    focusSection(state, now) +
    unlocksSection(state, now) +
    pendingSection(state);
  tickCountdowns();
}

async function refresh() {
  ctx = await send(M.GET_STATE);
  if (ctx) render();
}

app.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || !ctx) return;
  const act = el.dataset.act;
  if (act === "block") {
    const res = await submitOp({ type: "addSite", domain: el.dataset.domain }, ctx);
    if (res.ok) toast(`Mindfull will ask before ${el.dataset.domain} opens.`);
  } else if (act === "focus") {
    const minutes = Number(el.dataset.min);
    const res = await submitOp({ type: "startFocus", minutes }, ctx);
    if (res.ok) toast(`Focus session started for ${fmtMinutes(minutes)}.`);
  } else if (act === "end-focus") {
    await submitOp({ type: "endFocus" }, ctx, "End the focus session early");
  } else if (act === "resume") {
    const res = await submitOp({ type: "resumeProtection" }, ctx);
    if (res.ok) toast("Protection resumed.");
  } else if (act === "cancel") {
    await send(M.CANCEL_PENDING, { id: el.dataset.id });
    toast("Change cancelled.");
  }
  refresh();
});

$("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeUrl = tab && tab.url;
  // On our own pause page, talk about the site it's guarding.
  const pausePage = chrome.runtime.getURL("src/pause.html");
  if (activeUrl && activeUrl.startsWith(pausePage)) {
    const hash = activeUrl.indexOf("#");
    activeUrl = hash >= 0 ? activeUrl.slice(hash + 1) : null;
  }
  await refresh();
  startTicker();
  onStateChange(refresh);
  onMidnight(refresh);
  // Re-render when a countdown finishes so expired items disappear.
  document.addEventListener("mindfull:elapsed", () => setTimeout(refresh, 1200));
})();
