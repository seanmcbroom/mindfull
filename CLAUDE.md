# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mindfull is a Manifest V3 browser extension for Chrome and Firefox. It puts a short, escalating wait in front of listed sites, with daily open limits, restricted hours, focus sessions, and friction for loosening any of it. This file supersedes the Desktop-level CLAUDE.md, which describes a different project.

## Commands

```bash
npm install
npm test                                   # Jest, tests/*.test.js (plain CommonJS, no transform)
npx jest tests/policy.test.js              # one file
npx jest -t "reset exactly at 4 am"        # one test by name (substring of the test title)
npm run build:all | build:chrome | build:firefox  # → dist/<browser>/
npm run build:dev                          # __DEV__=true: adds 1-minute unlock/cooldown/focus options
npm run zip:all                            # build + releases/mindfull-<browser>.zip (adm-zip, cross-platform)
npm run icons                              # regenerate icons/*.png (zero-dependency PNG writer)
```

There is no lint step. Load `dist/chrome` via chrome://extensions → Load unpacked, or `dist/firefox/manifest.json` via about:debugging. User-facing behaviour is described in `README.md`.

## Architecture

- **Build (`scripts/build.js`):** esbuild bundles four IIFE entries into `dist/<target>/src/`:
  - `background/index.js` → `background.js`;
  - `pause/pause.js`;
  - `popup/popup.js`;
  - `options/options.js`.

  HTML/CSS files are listed in `STATIC` and copied. New static files must be added there. The manifest comes from `manifests/manifest.<target>.json` with `version` taken from package.json (`--dev` also appends " (dev)" to the name). Chrome uses `background.service_worker`; Firefox uses `background.scripts` plus `browser_specific_settings`. `__DEV__` is an esbuild `define`; `defaults.js` guards it with `typeof` so Jest can load it.
- **`src/shared/`** is pure logic with no `chrome.*` calls, and every function takes `now`. Keep it that way; it's what the tests cover.
  - `policy.js` `siteStatus(state, domain, now)` is the single decision function. Precedence: paused > focus > schedule > active unlock > daily limit > pause.
  - `ops.js`: every settings change is an op.
    - `isLoosening(op, state, now)` is the **single source of truth** for what needs the typed sentence plus cooldown. The UI and the background both call it.
    - `applyOp` is a pure reducer.
    - `advance(state, now)` applies due pending ops at their `applyAt`, expires unlocks/focus/pause and prunes stats/usage older than 7 days.
  - `rules.js` builds the DNR rules:
    - one priority-1 redirect per closed site, with the original URL in the pause page's `#hash`;
    - a priority-2 `allow` for an allowed subdomain under a closed parent.

    `rulesSignature` lets reconcile skip identical updates.
  - `usage.js` does time-spent tracking.
  - `friction.js` holds the wait escalation and `phrasesFor(op)` / `isCommitPhrase(typed, op)`.
  - `defaults.js` holds settings defaults, UI option lists and all user-facing phrase lists.
  - `ui.js` holds the DOM helpers shared by the pages (`send`, `submitOp`, `commitModal`, the countdown ticker, `onDayStart`).
- **State** is in `chrome.storage.local`:
  - `settings`;
  - `runtime` (unlocks, focus, pause, pending ops, wait start times, the open time-tracking segment);
  - `stats[day][domain]` = opens;
  - `usage[day][domain]` = ms.

  Day keys come from `time.js` `dayKey`: a day runs 04:00 to 04:00 local (`DAY_START_HOUR`), so all daily counts reset at 4 am, not midnight. Use `dayKey`/`nextDayStart` for anything daily; restricted hours (`schedule.js`) stay on calendar days.
- **Background (`src/background/`)** is the only writer.
  - `store.js` `mutate()` serialises read-modify-write.
  - `reconcile.js` `reconcile()` is idempotent. It runs on install/startup, every alarm (exact per-deadline alarms plus a 1-minute `tick`) and after every change. It advances state, syncs the DNR rules, redirects open tabs that are no longer allowed (`?r=expired` if an unlock just ran out), credits time spent (`trackActive`), and syncs alarms and the badge.
  - `handlers.js` handles the messages from `src/shared/messages.js` and rejects senders other than this extension. `GET_STATE` and `GET_SITE_STATUS` return `advance()`d state without saving it.
- **Pages** (`pause`, `popup`, `options`) never write storage. They send messages and re-render on `storage.onChanged` and at the 4 am day start (`onDayStart`).

### Key flows (each spans several files)

- **Entering a site:**
  1. A DNR redirect lands on `pause.html#<url>`.
  2. The page sends `BEGIN_PAUSE`, which records `runtime.pauseStarts["<tabId>:<domain>"]`.
  3. The countdown only runs while the tab is visible and focused.
  4. `REQUEST_UNLOCK` re-checks `siteStatus` and that the wait actually elapsed, server-side. It then records the unlock and the open, and runs `reconcile` (which drops the rule) before replying.
  5. Only then does the page `location.replace(url)`.
- **Loosening a setting:**
  1. `submitOp` calls `isLoosening`; if true, `commitModal` shows `randomPhrase(op)` with paste blocked.
  2. `APPLY_OP` re-verifies `isCommitPhrase(phrase, op)` and queues `{op, applyAt}` in `runtime.pending`.
  3. A per-item alarm fires, and `advance` applies the op.

  Tightening ops apply immediately.
- **Time spent:** `trackActive` runs on tab activate/update, window focus change and every reconcile. It credits the open segment and starts a new one for the listed, allowed site in the focused window's active tab. A single credit is capped at 2 min (sleep or a closed browser), and `onStartup` drops a stale segment.

### Gotchas

- Check host access with `permissions.contains({origins: ["http://*/*", "https://*/*"]})`. Checking `<all_urls>` also requires file:// access, which Chrome withholds, so it reports false.
- The Firefox redirect to `moz-extension://` works only because the pause page and its assets are listed in `web_accessible_resources` in both manifests.
- `ui.css` needs `[hidden] { display: none !important; }`, because component `display` rules otherwise override the `hidden` attribute.

## Conventions

- **Design:** the pause page looks like a plain browser "can't open this site" error page:
  - a big grey icon (pause bars while you can still enter, one bar when closed);
  - a system-font heading and short grey lines;
  - a small `ERR_…` code on time-up and closed states (`ERR_TIME_UP`, `ERR_DAILY_LIMIT_REACHED`…), but none on the normal wait;
  - Enter as an outlined button and Leave as the one filled blue button.

  Light and dark follow the system through the tokens in `ui.css`, and the popup and options pages share them. The owner rejected both polished/glossy versions and a bare textboard look ("too boring"). Keep it plain, with no animation or decoration, and keep the pause page minimal: heading, wait, one line of today's opens and time, Leave/Enter.
- **Copy:** plain sentence case. The pause-page action is "Enter", not "Stay".
- **Adding a setting:** add it to `DEFAULT_SETTINGS`, to `SETTING_RULES` in `ops.js` (validity, whether a change loosens it, and its label), and to the options page.
- **Phrase lists:** removal sentences use a `{site}` placeholder and are checked per op in the background.

## Contributing

Follows `.github/CONTRIBUTING.md`.

- Fork and PR workflow. Keep each PR focused on one change; split large changes into several PRs, and for major changes open a discussion in the **Issues** tab first. A project manager reviews every PR before it merges.
- Commit messages use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`, `docs:`, `refactor:`…).
- Update this file when behaviour, layout or a convention it describes changes.

**AI-assisted contributions**
- Add a `Co-Authored-By: <agent name> <agent email>` trailer to every commit containing AI-generated material (Claude Code: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`).
- Keep PR descriptions brief and state the human contributor's concrete real-world motivation.
- Never invent motivations, test results, measurements or citations.
