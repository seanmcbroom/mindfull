// The intercept page. Deliberately minimal: a heading, the wait, Leave/Enter, and one line
// about today. Blocked navigations arrive as pause.html#<original url>, optionally ?r=expired|blocked.

const M = require("../shared/messages");
const { send, esc, $, startTicker, tickCountdowns, onStateChange, toast } = require("../shared/ui");
const { hostOf } = require("../shared/domains");
const { fmtClock, fmtMinutes } = require("../shared/time");
const { DAY_NAMES } = require("../shared/schedule");
const { fmtUsage } = require("../shared/usage");
const { IMPULSE_PHRASES } = require("../shared/defaults");

const target = decodeTarget();
const reason = new URLSearchParams(location.search).get("r"); // "expired" | "blocked" | null
const view = $("#view");
const heading = pickHeading();

/** A random heading for this visit, never the same as the last one shown. */
function pickHeading() {
  const KEY = "mf-last-heading";
  let last = -1;
  try {
    last = parseInt(localStorage.getItem(KEY), 10);
  } catch {}
  let i = Math.floor(Math.random() * IMPULSE_PHRASES.length);
  if (i === last) i = (i + 1) % IMPULSE_PHRASES.length;
  try {
    localStorage.setItem(KEY, String(i));
  } catch {}
  return IMPULSE_PHRASES[i];
}

let status = null;
let rafId = null;
let refreshTimer = null;
let leaving = false;

function decodeTarget() {
  let raw = location.hash.slice(1);
  if (!raw) return null;
  if (!/^https?:/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return hostOf(raw) ? raw : null;
}

function stopCountdown() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function whenText(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? fmtClock(ts) : `${DAY_NAMES[d.getDay()]} ${fmtClock(ts)}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Opened 3 times today, 24 min in total." */
function todayLine(st) {
  const n = st.unlocksToday || 0;
  const ms = st.msToday || 0;
  if (!n && ms < 60000) return "You haven't opened it yet today.";
  return `Opened ${plural(n, "time")} today, ${fmtUsage(ms)} in total.`;
}

function page(site, title, body) {
  return `
    <p class="site">${esc(site)}</p>
    <h1 class="title">${esc(title)}</h1>
    ${body}`;
}

// ---------------------------------------------------------------- views

function renderInvalid() {
  view.innerHTML = page(
    "Mindfull",
    "Nothing to open here",
    `<p class="actions"><button class="btn btn-lg" id="leave">Close tab</button></p>`
  );
  $("#leave").addEventListener("click", closeTab);
}

function renderAllowed(st) {
  view.innerHTML = page(
    st.domain || hostOf(target),
    "You're clear to go",
    `<p class="actions"><button class="btn btn-lg" id="continue">Continue</button><button class="btn btn-lg" id="leave">Leave</button></p>`
  );
  $("#leave").addEventListener("click", leave);
  $("#continue").addEventListener("click", () => location.replace(target));
}

function renderHardblock(st) {
  const d = esc(st.domain);
  let title, line;
  if (st.reason === "focus") {
    title = "You're in a focus session";
    line = `Opens again in <b data-until="${st.until}"></b>.`;
  } else if (st.reason === "schedule") {
    title = "Restricted hours";
    line = `Opens again at ${esc(whenText(st.until))}.`;
  } else if (st.limit === 0) {
    title = "This one stays closed";
    line = `You set ${d} to zero opens a day.`;
  } else {
    title = "That's all for today";
    line = "Opens again at midnight.";
  }
  view.innerHTML = page(
    st.domain,
    title,
    `<p class="wait">${line}</p>
     <p class="actions"><button class="btn btn-lg" id="leave">Leave</button></p>
     <p class="today">${esc(todayLine(st))}</p>`
  );
  tickCountdowns();
  $("#leave").addEventListener("click", leave);
  // The background doesn't always write storage when a block lifts (e.g. at midnight), so re-check then.
  clearTimeout(refreshTimer);
  if (st.until) refreshTimer = setTimeout(refresh, Math.max(1000, st.until - Date.now() + 1500));
}

async function renderPause(st) {
  const begun = await send(M.BEGIN_PAUSE, { domain: st.domain });
  if (!begun || !begun.ok) {
    if (begun && begun.status) return render({ ...st, ...begun.status });
    return;
  }
  view.innerHTML = page(
    st.domain,
    reason === "expired" ? "Time's up" : heading,
    `<p class="wait" id="countline">Wait <b id="count"></b>s to enter</p>
     <p class="hint" id="hint"></p>
     <p class="actions" id="actions"><button class="btn btn-lg" id="leave">Leave</button><button class="btn btn-lg" id="stay" disabled>Enter</button></p>
     <p class="today">${esc(todayLine(st))}</p>`
  );
  $("#leave").addEventListener("click", leave);
  $("#stay").addEventListener("click", () => renderDurations(st));
  startCountdown(begun.waitSeconds);
}

function startCountdown(seconds) {
  stopCountdown();
  let remaining = seconds * 1000;
  let last = performance.now();
  const count = $("#count");
  const countline = $("#countline");
  const hint = $("#hint");
  const stay = $("#stay");

  const frame = (now) => {
    const dt = Math.min(now - last, 250);
    last = now;
    // The timer only runs while the page is actually in front of you.
    const present = document.visibilityState === "visible" && document.hasFocus();
    if (present) remaining = Math.max(0, remaining - dt);

    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      count.textContent = String(secs);
      stay.textContent = `Enter (${secs})`;
      hint.textContent = present ? "" : "The timer pauses while this tab isn't in front.";
    } else if (stay.disabled) {
      stay.disabled = false;
      stay.textContent = "Enter";
      count.textContent = "";
      countline.textContent = "You can enter now.";
      hint.textContent = "";
    }
    rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);
}

function renderDurations(st) {
  $("#countline").textContent = "For how long?";
  $("#hint").textContent = "";
  $("#actions").outerHTML = `
    <p class="actions dur-list" id="actions">${st.durations
      .map((m) => `<button class="btn btn-lg" data-min="${m}">${esc(fmtMinutes(m))}</button>`)
      .join("")}<button class="link-btn" id="leave2">Leave instead</button></p>`;
  $("#leave2").addEventListener("click", leave);
  $("#actions").addEventListener("click", async (e) => {
    const chip = e.target.closest("[data-min]");
    if (!chip) return;
    for (const c of document.querySelectorAll("[data-min]")) c.disabled = true;
    const res = await send(M.REQUEST_UNLOCK, { domain: st.domain, minutes: Number(chip.dataset.min) });
    if (res && res.ok) {
      stopCountdown();
      location.replace(target);
    } else {
      toast((res && res.error) || "Couldn't unlock this site. Try again.", "error");
      refresh(true);
    }
  });
}

function render(st) {
  status = st;
  stopCountdown();
  clearTimeout(refreshTimer);
  document.title = st.domain ? `${st.domain} - Mindfull` : "Mindfull";
  if (st.mode === "allowed") return renderAllowed(st);
  if (st.mode === "hardblock") return renderHardblock(st);
  return renderPause(st);
}

// ---------------------------------------------------------------- actions

async function closeTab() {
  const tab = await chrome.tabs.getCurrent();
  if (!tab) return window.close();
  const siblings = await chrome.tabs.query({ windowId: tab.windowId });
  if (siblings.length <= 1) await chrome.tabs.create({ windowId: tab.windowId });
  await chrome.tabs.remove(tab.id);
}

async function leave() {
  if (leaving) return;
  if (!target) return closeTab();
  leaving = true;
  stopCountdown();
  // After a time-out, "back" would just be the same site again, so close instead.
  if (reason !== "expired" && history.length > 1) history.back();
  else await closeTab();
}

// ---------------------------------------------------------------- lifecycle

async function refresh(force = false) {
  if (leaving || !target) return;
  const next = await send(M.GET_SITE_STATUS, { url: target });
  if (!next) return;
  const same =
    status && next.mode === status.mode && next.reason === status.reason && next.until === status.until;
  // Don't restart a running wait just because something unrelated changed.
  if (same && !force) return;
  render(next);
}

if (!target) {
  renderInvalid();
} else {
  startTicker();
  refresh(true);
  onStateChange(() => refresh());
  document.addEventListener("mindfull:elapsed", () => setTimeout(() => refresh(), 1200));
}
