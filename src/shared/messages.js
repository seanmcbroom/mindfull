// Message types exchanged between pages (pause/popup/options) and the background.
// Pages never write storage directly; they send one of these and re-render on
// chrome.storage.onChanged.
module.exports = {
  GET_STATE: "GET_STATE",             // -> { state, now }
  GET_SITE_STATUS: "GET_SITE_STATUS", // { url } -> siteStatus + { durations }
  BEGIN_PAUSE: "BEGIN_PAUSE",         // { domain } -> { ok, waitSeconds }
  REQUEST_UNLOCK: "REQUEST_UNLOCK",   // { domain, minutes } -> { ok, error? }
  APPLY_OP: "APPLY_OP",               // { op, phrase? } -> { ok, applied | pending, error? }
  CANCEL_PENDING: "CANCEL_PENDING",   // { id } -> { ok }
};
