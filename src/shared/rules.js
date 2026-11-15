// Builds declarativeNetRequest dynamic rules from state. One redirect rule per listed
// site that isn't currently allowed; the original URL is carried in the pause page's hash.

const { toRegexFilter, coversHost } = require("./domains");
const { siteStatus } = require("./policy");

function buildRules(state, now, pauseUrl) {
  const sites = [...state.settings.sites].sort((a, b) => a.domain.localeCompare(b.domain));
  const mode = new Map(sites.map((s) => [s.domain, siteStatus(state, s.domain, now).mode]));
  const rules = [];
  let id = 1;

  for (const s of sites) {
    if (mode.get(s.domain) === "allowed") continue;
    rules.push({
      id: id++,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: pauseUrl + "#\\0" } },
      condition: { regexFilter: toRegexFilter(s.domain), resourceTypes: ["main_frame"] },
    });
  }

  // A listed subdomain that's allowed while a listed parent is blocked needs an explicit
  // allow rule, or the parent's redirect would catch it.
  for (const s of sites) {
    if (mode.get(s.domain) !== "allowed") continue;
    const parentBlocked = sites.some(
      (p) => p.domain !== s.domain && coversHost(p.domain, s.domain) && mode.get(p.domain) !== "allowed"
    );
    if (parentBlocked) {
      rules.push({
        id: id++,
        priority: 2,
        action: { type: "allow" },
        condition: { requestDomains: [s.domain], resourceTypes: ["main_frame"] },
      });
    }
  }
  return rules;
}

/** Order-independent comparable form, robust to fields the browser adds when reading rules back. */
function rulesSignature(rules) {
  return rules
    .map((r) =>
      [
        r.priority,
        r.action.type,
        (r.action.redirect && r.action.redirect.regexSubstitution) || "",
        r.condition.regexFilter || "",
        (r.condition.requestDomains || []).join(","),
      ].join("|")
    )
    .sort()
    .join("\n");
}

module.exports = { buildRules, rulesSignature };
