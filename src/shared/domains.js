// Domain normalisation and matching.

const HOST_RE = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** "https://www.YouTube.com/shorts" -> "youtube.com"; returns null if not a usable host. */
function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = "http://" + s;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  return HOST_RE.test(host) ? host : null;
}

/** Hostname of an http(s) URL, or null. */
function hostOf(url) {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** True if host is domain or a subdomain of it. */
function coversHost(domain, host) {
  return host === domain || host.endsWith("." + domain);
}

/** The most specific listed site covering host, or null. `sites` is [{domain}]. */
function matchSite(host, sites) {
  if (!host) return null;
  let best = null;
  for (const s of sites) {
    if (coversHost(s.domain, host) && (!best || s.domain.length > best.length)) best = s.domain;
  }
  return best;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** RE2-compatible filter matching the whole URL of domain and its subdomains. */
function toRegexFilter(domain) {
  return "^https?://([^/?#]*\\.)?" + escapeRegex(domain) + "([:/?#].*)?$";
}

module.exports = { normalizeDomain, hostOf, coversHost, matchSite, toRegexFilter };
