// Friction primitives: the escalating wait and the commitment sentence check.

const { COMMIT_PHRASES, REMOVE_SITE_PHRASES } = require("./defaults");

/** Seconds to wait before "Enter" unlocks: base · 2^n, capped at maxWait. */
function waitSeconds(unlocksToday, { baseWait, maxWait }) {
  const n = Math.max(0, Math.min(unlocksToday || 0, 20));
  return Math.min(maxWait, baseWait * Math.pow(2, n));
}

/** Case/punctuation/whitespace-insensitive normalisation for phrase comparison. */
function normalizePhrase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sentences that may confirm `op`. Removing a site uses its own set naming that site. */
function phrasesFor(op) {
  if (op && op.type === "removeSite" && op.domain) {
    return REMOVE_SITE_PHRASES.map((p) => p.replace("{site}", op.domain));
  }
  return COMMIT_PHRASES;
}

function isCommitPhrase(typed, op) {
  const t = normalizePhrase(typed);
  return t.length > 0 && phrasesFor(op).some((p) => normalizePhrase(p) === t);
}

function randomPhrase(op) {
  const list = phrasesFor(op);
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { waitSeconds, normalizePhrase, phrasesFor, isCommitPhrase, randomPhrase };
