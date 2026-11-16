#!/usr/bin/env node
// Captures screenshots from the real Chrome build in headless Chrome for Testing. Run with
// `npm run screenshots` (builds first).
//   docs/screenshots/<screen>-<light|dark>.png   README images
//   docs/store/pause-1280x800.png                 Chrome Web Store / Firefox Add-ons listing
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
];

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

    for (const { screen, theme, scale, frame, file } of JOBS) {
      const state = seed(Date.now());
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
      await page.evaluateOnNewDocument(() => {
        Math.random = () => 0;
        try {
          localStorage.removeItem("mf-last-heading");
        } catch {}
      });
      if (screen.init) await page.evaluateOnNewDocument(screen.init);

      await page.goto(base + screen.path, { waitUntil: "load" });
      await page.bringToFront();
      if (frame) await page.addStyleTag({ content: FRAME_CSS });
      await screen.ready(page);
      if (screen.fitHeight) {
        const height = await screen.fitHeight(page);
        await page.setViewport({ width: screen.viewport.width, height, deviceScaleFactor: scale });
      }

      await page.screenshot({ path: file });
      console.log(path.relative(ROOT, file));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
