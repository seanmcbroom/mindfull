// Options page. All changes are ops submitted through submitOp(), which shows the
// commit-phrase modal for loosening changes. The page re-renders from background state.

const M = require("../shared/messages");
const { send, esc, $, startTicker, tickCountdowns, onStateChange, toast, submitOp } = require("../shared/ui");
const { coversHost } = require("../shared/domains");
const { siteStatus, isPaused, isFocusing } = require("../shared/policy");
const { describeOp } = require("../shared/ops");
const { describeSchedule, isScheduleActive, DAY_NAMES } = require("../shared/schedule");
const { fmtClock, fmtMinutes } = require("../shared/time");
const { CHOICES, SUGGESTED_SITES } = require("../shared/defaults");
const { usageToday, todaySummary } = require("../shared/usage");

let ctx = null; // { state, now }
const form = {
  editingId: null,
  days: new Set([1, 2, 3, 4, 5]),
  sites: new Set(),
};

const fmtSeconds = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);
const limitLabel = (v) => (v === null ? "No limit" : v === 0 ? "Always blocked" : String(v));

/** <option>s for a select, making sure the current value is present even if it's not a standard choice. */
function options(values, current, label) {
  const list = values.includes(current) ? values : [...values, current].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  return list
    .map((v) => `<option value="${v === null ? "none" : v}"${v === current ? " selected" : ""}>${esc(label(v))}</option>`)
    .join("");
}

async function apply(op) {
  const res = await submitOp(op, ctx, describeOp(op, ctx.state));
  await refresh(); // also reverts controls if the change was cancelled or is pending
  return res;
}

// ---------------------------------------------------------------- render

function renderPending(state) {
  const items = state.runtime.pending;
  $("#pending-section").hidden = items.length === 0;
  $("#pending-list").innerHTML = items
    .map(
      (p) => `<li>
        <span class="grow">${esc(p.label || describeOp(p.op, state))}</span>
        <span class="muted tabular">in <span data-until="${p.applyAt}"></span></span>
        <button class="btn btn-sm" data-act="cancel" data-id="${esc(p.id)}">Cancel</button>
      </li>`
    )
    .join("");
}

function renderSites(state, now) {
  const list = $("#site-list");
  if (!state.settings.sites.length) {
    list.innerHTML = `<li class="empty">No sites yet. Add one above or pick a suggestion.</li>`;
  } else {
    list.innerHTML = state.settings.sites
      .map((s) => {
        const st = siteStatus(state, s.domain, now);
        let badge = "";
        if (st.reason === "unlocked") badge = `<span class="pill on">open for <span data-until="${st.until}"></span></span>`;
        else if (st.mode === "hardblock") badge = `<span class="pill off">closed</span>`;
        const limitSelect = `<select class="select" data-act="limit" data-domain="${esc(s.domain)}" aria-label="Daily opens for ${esc(s.domain)}">
            <option value="default"${s.dailyLimit === null ? " selected" : ""}>Default (${esc(limitLabel(state.settings.defaultDailyLimit))})</option>
            ${CHOICES.dailyLimit
              .concat(s.dailyLimit !== null && !CHOICES.dailyLimit.includes(s.dailyLimit) ? [s.dailyLimit] : [])
              .map((v) => `<option value="${v}"${v === s.dailyLimit ? " selected" : ""}>${esc(limitLabel(v))}</option>`)
              .join("")}
          </select>`;
        return `<li>
          <span class="grow domain">${esc(s.domain)}</span>
          ${badge}
          <span class="muted small">${todaySummary(st.unlocksToday, usageToday(state, s.domain, now))}</span>
          <label class="mini">Opens a day ${limitSelect}</label>
          <button class="btn btn-danger btn-sm" data-act="remove" data-domain="${esc(s.domain)}">Remove</button>
        </li>`;
      })
      .join("");
  }

  const suggestions = SUGGESTED_SITES.filter((d) => !state.settings.sites.some((s) => coversHost(s.domain, d)));
  $("#suggestions").innerHTML = suggestions
    .map((d) => `<button class="chip" type="button" data-domain="${esc(d)}">+ ${esc(d)}</button>`)
    .join("");
}

function renderLimits(state) {
  $("#default-limit").innerHTML = options(
    [1, 2, 3, 5, 10, 20, 50, null],
    state.settings.defaultDailyLimit,
    limitLabel
  );
}

function renderSchedules(state, now) {
  const list = $("#schedule-list");
  list.innerHTML = state.settings.schedules
    .map(
      (s) => `<li>
        <span class="grow">${esc(describeSchedule(s))}</span>
        ${isScheduleActive(s, now) ? `<span class="pill off">active now</span>` : ""}
        <button class="btn btn-sm" data-act="edit" data-id="${esc(s.id)}">Edit</button>
        <button class="btn btn-danger btn-sm" data-act="remove" data-id="${esc(s.id)}">Remove</button>
      </li>`
    )
    .join("");
  renderScheduleForm(state);
}

function renderScheduleForm(state) {
  $("#day-chips").innerHTML = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => `<button type="button" class="chip" data-day="${d}" aria-pressed="${form.days.has(d)}">${DAY_NAMES[d]}</button>`)
    .join("");
  const some = document.querySelector('input[name="sch-sites"][value="some"]').checked;
  const chips = $("#sch-site-chips");
  chips.hidden = !some;
  chips.innerHTML = state.settings.sites.length
    ? state.settings.sites
        .map(
          (s) =>
            `<button type="button" class="chip" data-site="${esc(s.domain)}" aria-pressed="${form.sites.has(s.domain)}">${esc(s.domain)}</button>`
        )
        .join("")
    : `<span class="muted small">Add some sites first.</span>`;
}

function renderFriction(state) {
  const { settings } = state;
  $("#base-wait").innerHTML = options(CHOICES.baseWait, settings.baseWait, fmtSeconds);
  $("#max-wait").innerHTML = options(CHOICES.maxWait, settings.maxWait, fmtSeconds);
  $("#cooldown").innerHTML = options(CHOICES.cooldownMinutes, settings.cooldownMinutes, (v) =>
    v === 0 ? "None" : fmtMinutes(v)
  );
  const all = [...new Set([...CHOICES.unlockDurations, ...settings.unlockDurations])].sort((a, b) => a - b);
  $("#duration-chips").innerHTML = all
    .map(
      (m) =>
        `<button type="button" class="chip" data-min="${m}" aria-pressed="${settings.unlockDurations.includes(m)}">${esc(fmtMinutes(m))}</button>`
    )
    .join("");
}

function renderProtection(state, now) {
  const { runtime } = state;
  const status = $("#protection-status");
  const actions = $("#protection-actions");
  if (isPaused(runtime, now)) {
    status.textContent =
      runtime.paused.until === null
        ? "Mindfull is turned off. Your sites open without asking."
        : `Mindfull is paused until ${fmtClock(runtime.paused.until)}. Your sites open without asking.`;
    actions.innerHTML = `<button class="btn btn-primary" data-act="resume">Resume Mindfull</button>`;
    return;
  }
  status.textContent = isFocusing(runtime, now)
    ? `Focus session running until ${fmtClock(runtime.focus.endsAt)}.`
    : "Mindfull is on. Pausing or turning it off counts as loosening, so it waits out the cooldown.";
  actions.innerHTML =
    CHOICES.pauseMinutes
      .map((m) => `<button class="btn" data-act="pause" data-min="${m}">Pause for ${esc(fmtMinutes(m))}</button>`)
      .join("") + `<button class="btn btn-danger" data-act="off">Turn off Mindfull</button>`;
}

function render() {
  const { state } = ctx;
  const now = Date.now();
  renderPending(state);
  renderSites(state, now);
  renderLimits(state);
  renderSchedules(state, now);
  renderFriction(state);
  renderProtection(state, now);
  tickCountdowns();
}

async function refresh() {
  ctx = await send(M.GET_STATE);
  if (ctx) render();
}

// ---------------------------------------------------------------- events

$("#add-site").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#site-input");
  if (!input.value.trim()) return;
  const res = await apply({ type: "addSite", domain: input.value });
  if (res.ok) {
    input.value = "";
    toast("Site added.");
  }
});

$("#suggestions").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-domain]");
  if (chip) apply({ type: "addSite", domain: chip.dataset.domain });
});

$("#site-list").addEventListener("change", (e) => {
  const sel = e.target.closest('[data-act="limit"]');
  if (!sel) return;
  apply({ type: "setDailyLimit", domain: sel.dataset.domain, value: sel.value === "default" ? null : Number(sel.value) });
});

$("#site-list").addEventListener("click", (e) => {
  const btn = e.target.closest('[data-act="remove"]');
  if (btn) apply({ type: "removeSite", domain: btn.dataset.domain });
});

$("#default-limit").addEventListener("change", (e) => {
  const v = e.target.value;
  apply({ type: "setSetting", key: "defaultDailyLimit", value: v === "none" ? null : Number(v) });
});

$("#base-wait").addEventListener("change", (e) => apply({ type: "setSetting", key: "baseWait", value: Number(e.target.value) }));
$("#max-wait").addEventListener("change", (e) => apply({ type: "setSetting", key: "maxWait", value: Number(e.target.value) }));
$("#cooldown").addEventListener("change", (e) =>
  apply({ type: "setSetting", key: "cooldownMinutes", value: Number(e.target.value) })
);

$("#duration-chips").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-min]");
  if (!chip) return;
  const m = Number(chip.dataset.min);
  const current = new Set(ctx.state.settings.unlockDurations);
  if (current.has(m)) current.delete(m);
  else current.add(m);
  if (!current.size) return toast("Keep at least one Stay option.");
  apply({ type: "setSetting", key: "unlockDurations", value: [...current].sort((a, b) => a - b) });
});

$("#protection-actions").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.dataset.act === "pause") apply({ type: "pauseProtection", minutes: Number(btn.dataset.min) });
  if (btn.dataset.act === "off") apply({ type: "pauseProtection", minutes: null });
  if (btn.dataset.act === "resume") apply({ type: "resumeProtection" });
});

$("#pending-list").addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-act="cancel"]');
  if (!btn) return;
  await send(M.CANCEL_PENDING, { id: btn.dataset.id });
  toast("Change cancelled.");
  refresh();
});

// Schedules ---------------------------------------------------------

function openScheduleForm(schedule) {
  form.editingId = schedule ? schedule.id : null;
  form.days = new Set(schedule ? schedule.days : [1, 2, 3, 4, 5]);
  form.sites = new Set(schedule && Array.isArray(schedule.sites) ? schedule.sites : []);
  $("#sch-start").value = schedule ? schedule.start : "09:00";
  $("#sch-end").value = schedule ? schedule.end : "17:00";
  document.querySelector(
    `input[name="sch-sites"][value="${schedule && Array.isArray(schedule.sites) ? "some" : "all"}"]`
  ).checked = true;
  $("#schedule-form-title").textContent = schedule ? "Edit restricted hours" : "New restricted hours";
  $("#schedule-form").hidden = false;
  $("#new-schedule").hidden = true;
  renderScheduleForm(ctx.state);
}

function closeScheduleForm() {
  $("#schedule-form").hidden = true;
  $("#new-schedule").hidden = false;
  form.editingId = null;
}

$("#new-schedule").addEventListener("click", () => openScheduleForm(null));
$("#sch-cancel").addEventListener("click", closeScheduleForm);

$("#schedule-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const schedule = ctx.state.settings.schedules.find((s) => s.id === btn.dataset.id);
  if (!schedule) return;
  if (btn.dataset.act === "edit") openScheduleForm(schedule);
  if (btn.dataset.act === "remove") apply({ type: "removeSchedule", id: schedule.id });
});

$("#schedule-form").addEventListener("click", (e) => {
  const day = e.target.closest("[data-day]");
  const site = e.target.closest("[data-site]");
  if (day) {
    const d = Number(day.dataset.day);
    form.days.has(d) ? form.days.delete(d) : form.days.add(d);
  } else if (site) {
    const s = site.dataset.site;
    form.sites.has(s) ? form.sites.delete(s) : form.sites.add(s);
  } else return;
  renderScheduleForm(ctx.state);
});

$("#schedule-form").addEventListener("change", (e) => {
  if (e.target.name === "sch-sites") renderScheduleForm(ctx.state);
});

$("#schedule-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const some = document.querySelector('input[name="sch-sites"][value="some"]').checked;
  const schedule = {
    id: form.editingId || `s${Date.now().toString(36)}`,
    days: [...form.days].sort((a, b) => a - b),
    start: $("#sch-start").value.slice(0, 5),
    end: $("#sch-end").value.slice(0, 5),
    sites: some ? [...form.sites].filter((d) => ctx.state.settings.sites.some((s) => s.domain === d)) : "all",
  };
  const res = await apply({ type: form.editingId ? "updateSchedule" : "addSchedule", schedule });
  if (res.ok) closeScheduleForm();
});

// Permissions & environment -----------------------------------------

// Only web origins matter. (Checking "<all_urls>" would also require file:// access,
// which Chrome withholds by default, so it would report false even when we're fine.)
const WEB_ORIGINS = { origins: ["http://*/*", "https://*/*"] };

async function checkPermissions() {
  try {
    $("#perm-banner").hidden = await chrome.permissions.contains(WEB_ORIGINS);
  } catch {
    $("#perm-banner").hidden = true;
  }
}

$("#grant").addEventListener("click", async () => {
  try {
    await chrome.permissions.request(WEB_ORIGINS);
  } finally {
    checkPermissions();
  }
});

async function checkIncognito() {
  const el = $("#incognito-status");
  try {
    const allowed = await chrome.extension.isAllowedIncognitoAccess();
    el.textContent = allowed
      ? "Mindfull runs there too."
      : "Mindfull isn't allowed in private windows yet. To close that gap, enable it in the extension's details page in your browser.";
  } catch {
    el.textContent = "Check your browser's extension settings to allow Mindfull in private windows.";
  }
}

(async () => {
  await refresh();
  startTicker();
  onStateChange(refresh);
  document.addEventListener("mindfull:elapsed", () => setTimeout(refresh, 1200));
  checkPermissions();
  checkIncognito();
})();
