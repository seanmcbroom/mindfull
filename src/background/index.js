// Background entry (Chrome service worker / Firefox event page). Listeners only;
// all logic lives in reconcile.js and handlers.js. Listeners are registered
// synchronously at top level so the browser can wake the worker for them.

const { reconcile, trackActive, setTabBadge, domainForUrl } = require("./reconcile");
const { handleMessage } = require("./handlers");
const { loadState, mutate } = require("./store");
const { siteStatus } = require("../shared/policy");

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await reconcile();
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(async () => {
  // A segment left open by the last session would count closed-browser time; drop it.
  await mutate((draft) => {
    draft.runtime.active = null;
  });
  reconcile();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  // Alarms can fire a hair early; treat their scheduled time as "now" so the deadline counts as reached.
  reconcile(alarm.name === "tick" ? 0 : alarm.scheduledTime);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async response
});

async function refreshBadge(tabId, url) {
  const state = await loadState();
  const domain = domainForUrl(state, url);
  await setTabBadge(tabId, domain ? siteStatus(state, domain, Date.now()) : null).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url) refreshBadge(tabId, tab.url);
  if (info.url || info.status === "complete") trackActive();
});

// Time tracking: whatever is in front changes when tabs or windows switch.
chrome.tabs.onActivated.addListener(() => trackActive());
chrome.windows.onFocusChanged.addListener(() => trackActive());

chrome.action.setBadgeBackgroundColor({ color: "#cc0000" });
if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: "#ffffff" });

// Every wake-up: make sure the browser matches stored state.
reconcile();
