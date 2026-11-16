// DOM helpers shared by the pause page, popup and options page.

const M = require("./messages");
const { fmtCountdown, fmtMinutes, nextMidnight } = require("./time");
const { isLoosening } = require("./ops");
const { normalizePhrase, randomPhrase } = require("./friction");

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s) {
  return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
}

const $ = (sel, root = document) => root.querySelector(sel);

/** Fill every [data-until] element with its countdown. Emits "mindfull:elapsed" when one hits zero. */
function tickCountdowns() {
  const now = Date.now();
  for (const el of document.querySelectorAll("[data-until]")) {
    const left = Number(el.dataset.until) - now;
    el.textContent = fmtCountdown(left);
    if (left <= 0 && !el.dataset.elapsed) {
      el.dataset.elapsed = "1";
      document.dispatchEvent(new CustomEvent("mindfull:elapsed"));
    }
  }
}

/** Keeps countdowns live. Call tickCountdowns() right after rendering so they're never blank. */
function startTicker() {
  tickCountdowns();
  return setInterval(tickCountdowns, 500);
}

/**
 * Run cb just after every local midnight. Daily counts and "closed until midnight" change
 * then without the background writing anything, so open pages wouldn't notice otherwise.
 */
function onMidnight(cb) {
  setTimeout(() => {
    cb();
    onMidnight(cb);
  }, nextMidnight(Date.now()) - Date.now() + 1000);
}

/** Re-run cb whenever the background writes state. */
function onStateChange(cb) {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") cb();
  });
}

let toastTimer;
function toast(message, kind = "info") {
  let el = $("#mf-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "mf-toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
}

/**
 * Asks the user to type a commitment phrase (no pasting). Resolves to the typed phrase, or null.
 */
function commitModal({ label, cooldownMinutes, op }) {
  return new Promise((resolve) => {
    const phrase = randomPhrase(op);
    const delay =
      cooldownMinutes > 0
        ? `If you go ahead, it takes effect in ${esc(fmtMinutes(cooldownMinutes))}. You can cancel it until then.`
        : "If you go ahead, it takes effect immediately.";
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mf-modal-title">
        <h2 id="mf-modal-title">${esc(label)}</h2>
        <p>This loosens one of your limits. ${delay}</p>
        <p>To continue, type this sentence:</p>
        <p class="phrase" aria-label="Sentence to type">${esc(phrase)}</p>
        <input class="input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Type the sentence">
        <div class="row">
          <button type="button" class="btn" data-act="ok" disabled>Request change</button>
          <button type="button" class="btn" data-act="cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = $("input", wrap);
    const ok = $('[data-act="ok"]', wrap);
    const block = (e) => {
      e.preventDefault();
      toast("Pasting is turned off here. Type the sentence instead.");
    };
    input.addEventListener("paste", block);
    input.addEventListener("drop", block);
    input.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") block(e);
    });
    const matches = () => normalizePhrase(input.value) === normalizePhrase(phrase);
    input.addEventListener("input", () => {
      ok.disabled = !matches();
    });
    const close = (value) => {
      document.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter" && matches()) close(input.value);
    };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (e.target === wrap || (act && act.dataset.act === "cancel")) close(null);
      else if (act && act.dataset.act === "ok" && matches()) close(input.value);
    });
    input.focus();
  });
}

/**
 * Submit an op: tightening ops go straight through, loosening ones go through the
 * commit modal first. `ctx` is the latest { state, now } from GET_STATE.
 */
async function submitOp(op, ctx, label) {
  let phrase;
  if (isLoosening(op, ctx.state, Date.now())) {
    phrase = await commitModal({ label, cooldownMinutes: ctx.state.settings.cooldownMinutes, op });
    if (phrase === null) return { ok: false, cancelled: true };
  }
  const res = await send(M.APPLY_OP, { op, phrase });
  if (!res || !res.ok) toast((res && res.error) || "Something went wrong.", "error");
  else if (res.pending) toast(`Change requested. It applies in ${fmtCountdown(res.pending.applyAt - Date.now())} unless you cancel it.`);
  return res || { ok: false };
}

module.exports = { send, esc, $, startTicker, tickCountdowns, onStateChange, onMidnight, toast, commitModal, submitOp };
