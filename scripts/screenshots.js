#!/usr/bin/env node
// Captures screenshots from the real Chrome build in headless Chrome for Testing. Run with
// `npm run screenshots` (builds first).
//   docs/screenshots/<screen>-<light|dark>.png   README images
//   docs/store/hero-1280x800.png                  store lead image: browser window + popup
//   docs/store/pause-1280x800.png                 store screenshot: the pause page alone
// (Both stores take 1280×800 gallery images: Chrome Web Store and Firefox Add-ons.)
// The extension's storage is seeded through its service worker before every capture, so the
// same example state shows in every image.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { dayKey } = require("../src/shared/time");
const { describeOp } = require("../src/shared/ops");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "dist", "chrome");
const OUT = path.join(ROOT, "docs", "screenshots");
const STORE_OUT = path.join(ROOT, "docs", "store");
const MIN = 60000;

function seed(now) {
  const today = dayKey(now);
  const settings = {
    sites: [
      { domain: "youtube.com", dailyLimit: null },
      { domain: "reddit.com", dailyLimit: 2 },
      { domain: "x.com", dailyLimit: null },
      { domain: "instagram.com", dailyLimit: 0 },
    ],
  };
  // No restricted hours: one that covered the time this runs would close every site.
  const op = { type: "removeSite", domain: "x.com" };
  return {
    settings,
    runtime: {
      pending: [{ id: "demo", op, label: describeOp(op, { settings }), createdAt: now, applyAt: now + 8 * MIN }],
    },
    stats: { [today]: { "youtube.com": 1, "reddit.com": 2 } },
    usage: { [today]: { "youtube.com": 12 * MIN, "reddit.com": 31 * MIN } },
  };
}

// A 1px frame so the light shots don't melt into GitHub's white page. Screenshots only.
const FRAME_CSS = `body::after { content: ""; position: fixed; inset: 0; border: 1px solid var(--line);
  pointer-events: none; z-index: 1000; }`;

// A blinking text cursor would make captures differ from run to run.
const STABLE_CSS = `* { caret-color: transparent !important; }`;

const SCREENS = [
  {
    name: "pause",
    path: "src/pause.html#https://www.youtube.com/",
    viewport: { width: 800, height: 520 },
    ready: (page) => page.waitForFunction(() => /\d/.test(document.querySelector("#count")?.textContent || "")),
  },
  {
    name: "closed",
    path: "src/pause.html#https://www.reddit.com/",
    viewport: { width: 800, height: 520 },
    ready: (page) => page.waitForSelector(".code"),
  },
  {
    name: "popup",
    path: "src/popup.html",
    viewport: { width: 300, height: 600 },
    // A popup asks for the active tab; pretend it's youtube.com so "This site" shows.
    init: () => {
      chrome.tabs.query = async () => [{ id: 1, url: "https://www.youtube.com/" }];
    },
    ready: (page) => page.waitForSelector(".g-section"),
    fitHeight: (page) => page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height)),
  },
  {
    name: "settings",
    path: "src/options.html",
    viewport: { width: 800, height: 900 },
    ready: (page) => page.waitForSelector("#site-list li"),
    fitHeight: (page) => page.evaluate(() => Math.ceil(document.querySelector("#sites").getBoundingClientRect().bottom) + 28),
  },
  {
    name: "confirm",
    path: "src/options.html",
    viewport: { width: 800, height: 560 },
    ready: async (page) => {
      await page.waitForSelector('[data-act="remove"][data-domain="youtube.com"]');
      await page.click('[data-act="remove"][data-domain="youtube.com"]');
      await page.waitForSelector(".modal .phrase");
    },
  },
];

const JOBS = [
  ...SCREENS.flatMap((screen) =>
    ["light", "dark"].map((theme) => ({
      screen,
      theme,
      scale: 2,
      frame: true,
      file: path.join(OUT, `${screen.name}-${theme}.png`),
    }))
  ),
  // Store listings take exactly 1280×800 (Chrome also allows no alpha; these are RGB). Laid out
  // at 800×500 and scaled 1.6× so the text stays readable in the stores' smaller previews.
  {
    screen: { ...SCREENS.find((s) => s.name === "pause"), viewport: { width: 800, height: 500 } },
    theme: "light",
    scale: 1.6,
    frame: false,
    file: path.join(STORE_OUT, "pause-1280x800.png"),
  },
  // Frameless captures kept in memory for the store hero below.
  ...["pause", "popup"].map((name) => ({
    screen: SCREENS.find((s) => s.name === name),
    theme: "light",
    scale: 2,
    frame: false,
    key: name,
  })),
];

const dataUri = (buf) => `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;

/**
 * The lead image for the store galleries (1280×800): the pause page in a plain, generic browser
 * window, with the toolbar popup open. Built from the frameless captures above.
 */
function heroHtml(shots) {
  const icon = dataUri(fs.readFileSync(path.join(ROOT, "icons", "icon48.png")));
  return `<!doctype html><meta charset="utf-8"><style>
    :root { --bg: #ffffff; --line: #d3d7dd; --paper: #f4f5f7; --tint: #eaf1fc; --chrome: #e6e8eb; --fg: #1d1f23;
      --font: system-ui, "Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
    body { background: var(--paper); color: var(--fg); font-family: var(--font); }
    .win { position: absolute; left: 80px; top: 44px; width: 1120px; border: 1px solid var(--line);
      border-radius: 8px 8px 0 0; overflow: hidden; background: var(--bg); }
    .tabs { height: 42px; background: var(--chrome); display: flex; align-items: flex-end; padding: 0 10px; }
    .tab { height: 34px; width: 250px; display: flex; align-items: center; gap: 8px; padding: 0 12px; margin-bottom: -1px;
      background: var(--bg); border: 1px solid var(--line); border-bottom: none; border-radius: 6px 6px 0 0; font-size: 13px; }
    .tab img { width: 16px; height: 16px; }
    .tools { height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 10px; border-bottom: 1px solid var(--line); }
    .addr { flex: 1; height: 30px; border-radius: 6px; background: var(--paper); }
    .button { width: 32px; height: 32px; border-radius: 6px; display: grid; place-items: center; background: var(--tint); }
    .button img { width: 18px; height: 18px; }
    .page { display: block; width: 1118px; }
    .popup { position: absolute; right: 84px; top: 128px; width: 302px; border: 1px solid var(--line); border-radius: 6px;
      overflow: hidden; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12); }
    .popup img { display: block; width: 300px; }
  </style>
  <div class="win">
    <div class="tabs"><div class="tab"><img src="${icon}" alt="">youtube.com - Mindfull</div></div>
    <div class="tools"><div class="addr"></div><div class="button"><img src="${icon}" alt=""></div></div>
    <img class="page" src="${dataUri(shots.pause)}" alt="">
  </div>
  <div class="popup"><img src="${dataUri(shots.popup)}" alt=""></div>`;
}

async function renderHero(browser, shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.setContent(heroHtml(shots), { waitUntil: "load" });
  const file = path.join(STORE_OUT, "hero-1280x800.png");
  await page.screenshot({ path: file });
  console.log(path.relative(ROOT, file));
  await page.close();
}

async function main() {
  if (!fs.existsSync(path.join(EXT, "manifest.json"))) {
    throw new Error("dist/chrome is missing. Run `npm run build:chrome` first.");
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(STORE_OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    enableExtensions: [EXT],
    args: ["--lang=en-US"],
  });
  try {
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().endsWith("/src/background.js")
    );
    const worker = await swTarget.worker();
    const base = `chrome-extension://${new URL(swTarget.url()).host}/`;

    const shots = {};
    for (const { screen, theme, scale, frame, file, key } of JOBS) {
      const now = Date.now();
      const state = seed(now);
      await worker.evaluate(async (s) => {
        await chrome.storage.local.clear();
        await chrome.storage.local.set(s);
      }, state);

      const page = await browser.newPage();
      await page.setViewport({ ...screen.viewport, deviceScaleFactor: scale });
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      const cdp = await page.createCDPSession();
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      // Fixed picks: heading "This may be an impulse", sentence "I want youtube.com to open without asking".
      // The pause page also skips whichever heading it showed last, so forget that.
      // The page clock is pinned to the seed time so countdowns ("8:00") don't tick between runs.
      await page.evaluateOnNewDocument((frozen) => {
        Math.random = () => 0;
        Date.now = () => frozen;
        try {
          localStorage.removeItem("mf-last-heading");
        } catch {}
      }, now);
      if (screen.init) await page.evaluateOnNewDocument(screen.init);

      await page.goto(base + screen.path, { waitUntil: "load" });
      await page.bringToFront();
      await page.addStyleTag({ content: STABLE_CSS });
      if (frame) await page.addStyleTag({ content: FRAME_CSS });
      await screen.ready(page);
      if (screen.fitHeight) {
        const height = await screen.fitHeight(page);
        await page.setViewport({ width: screen.viewport.width, height, deviceScaleFactor: scale });
      }

      // Let a just-opened overlay finish rasterising before capturing.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const shot = await page.screenshot(file ? { path: file } : {});
      if (file) console.log(path.relative(ROOT, file));
      if (key) shots[key] = shot;
      await page.close();
    }
    await renderHero(browser, shots);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
