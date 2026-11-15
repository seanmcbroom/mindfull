# Mindfull

A browser extension (Chrome and Firefox) that puts a mindful pause between you and distracting sites.

When you open a site on your list, Mindfull asks **"Do you need this right now?"**

- **Leave** takes you back, or closes the tab.
- **Stay** unlocks only after a guided breathing pause. The pause doubles with each unlock of that site today (10s → 20s → 40s …, up to 2 min). Then you choose how long you need. When that time is up, the tab comes back to the pause page and the next pause is longer.

More features:

- **Daily opens:** a per-site cap on how many times you can choose Stay each day. Once it's reached, the site stays closed until midnight.
- **Restricted hours:** schedules (e.g. weekdays 9–5) during which sites are fully blocked.
- **Focus sessions:** 25/50/90 minutes with every listed site fully blocked.
- **Friction for loosening:** making things stricter applies instantly. Removing a site, raising a limit, pausing protection or ending a focus session early requires typing a commitment sentence (no pasting). The change then only takes effect after a cooldown (default 10 min), and you can cancel it until then.

Everything is stored locally in the browser. Nothing is sent anywhere.

## Develop

```bash
npm install
npm test                 # Jest unit tests for all policy logic (tests/*.test.js)
npm run build:all        # dist/chrome and dist/firefox
npm run build:dev        # same, plus 1-minute unlock/cooldown/focus options for manual testing
npm run zip:all          # build + releases/mindfull-<browser>.zip
npm run icons            # regenerate icons/*.png
```

To load the build:

- **Chrome:** go to `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `dist/chrome`.
- **Firefox:** go to `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and select `dist/firefox/manifest.json`.

## How it works

- `src/shared/` holds pure, unit-tested logic. Every function takes `now` explicitly.
  - `policy.js` (`siteStatus`) decides whether a site is allowed, needs a pause or is hard-blocked. Precedence: protection paused > focus > restricted hours > active unlock > daily limit > pause.
  - `ops.js` defines every settings change as an op. `isLoosening` is the single source of truth for which changes need the phrase and cooldown; `advance` moves state forward in time.
  - `rules.js` turns state into `declarativeNetRequest` redirect rules (one per blocked site). The original URL travels in the pause page's hash.
- `src/background/` is the only writer of `chrome.storage.local`. `reconcile()` is idempotent and runs on startup, on every alarm, every minute and after every change. It applies due pending changes, expires unlocks, syncs DNR rules, sends open tabs that are no longer allowed back to the pause page, and updates alarms and the badge.
- `src/pause`, `src/popup` and `src/options` are the pages. They never write storage directly: they send messages (`src/shared/messages.js`) and re-render on `storage.onChanged`.

A limitation: an extension can't stop you from disabling it on the browser's extensions page. Mindfull's friction only applies to changes made inside Mindfull.
