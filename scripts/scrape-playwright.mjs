// GitHub Actions / local runner: scrapes ingatlan.com via headless Chromium
// to bypass Cloudflare bot challenge, then writes records to Postgres.
//
// Required env:
//   DATABASE_URL or NETLIFY_DATABASE_URL
// Optional env:
//   SCRAPE_MAX_PAGES_PER_TYPE (default 10)
//   SCRAPE_MAX_DETAILS        (default 200)
//   SCRAPE_MIN_DELAY_MS       (default 1500)
//   SCRAPE_MAX_DELAY_MS       (default 4500)
//   SCRAPE_HEADLESS           (default "true")

import { chromium } from "playwright";
import { withClient } from "../netlify/functions/_db.mjs";
import { upsertListing } from "../netlify/functions/scrape_daily.mjs";
import {
  parseListHtml,
  parseDetailHtml,
  parseHirdetesId,
} from "../netlify/functions/_scrape_core.mjs";

const LIST_URLS = [
  "https://ingatlan.com/lista/elado+lakas+i-ker+ii-ker+iii-ker+iv-ker+ix-ker+v-ker+vi-ker+vii-ker+viii-ker+x-ker+xi-ker+xii-ker+xiii-ker+xiv-ker+xix-ker+xv-ker+xvi-ker+xvii-ker+xviii-ker+xx-ker+xxi-ker+xxii-ker+xxiii-ker",
  "https://ingatlan.com/lista/elado+haz+i-ker+ii-ker+iii-ker+iv-ker+ix-ker+v-ker+vi-ker+vii-ker+viii-ker+x-ker+xi-ker+xii-ker+xiii-ker+xiv-ker+xix-ker+xv-ker+xvi-ker+xvii-ker+xviii-ker+xx-ker+xxi-ker+xxii-ker+xxiii-ker",
];

const MAX_PAGES = Number(process.env.SCRAPE_MAX_PAGES_PER_TYPE || 10);
const MAX_DETAILS = Number(process.env.SCRAPE_MAX_DETAILS || 200);
const MIN_DELAY = Number(process.env.SCRAPE_MIN_DELAY_MS || 1500);
const MAX_DELAY = Number(process.env.SCRAPE_MAX_DELAY_MS || 4500);
const HEADLESS = String(process.env.SCRAPE_HEADLESS || "true") !== "false";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () =>
  sleep(Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY);

function isBlockedHtml(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("csak egy gyors ellen") ||
    s.includes("just a moment") ||
    s.includes("attention required")
  );
}

async function gotoWithChallenge(page, url, { tries = 4, maxWaitMs = 25000 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (err) {
      console.warn(`[NAV] goto failed (${attempt}/${tries}): ${err.message}`);
      await sleep(2000);
      continue;
    }
    // Poll until challenge clears or timeout elapses.
    const deadline = Date.now() + maxWaitMs;
    let html = await page.content();
    while (isBlockedHtml(html) && Date.now() < deadline) {
      await page.waitForTimeout(1500);
      html = await page.content();
    }
    if (!isBlockedHtml(html)) {
      // Ensure DOM settled a tiny bit more.
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return html;
    }
    console.warn(`[CF] still blocked after ${maxWaitMs}ms (attempt ${attempt}/${tries}) ${url}`);
    await sleep(2500 + attempt * 1500);
  }
  throw new Error(`Cloudflare challenge not solved for ${url}`);
}

async function newStealthContext(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    locale: "hu-HU",
    timezoneId: "Europe/Budapest",
    viewport: { width: 1366, height: 850 },
    extraHTTPHeaders: {
      "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8",
    },
  });
  // Minimal stealth: hide webdriver, fake chrome runtime, plugins, languages
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", {
      get: () => ["hu-HU", "hu", "en"],
    });
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });
    // eslint-disable-next-line no-undef
    window.chrome = { runtime: {} };
    const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (p) =>
        p && p.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(p);
    }
  });
  return context;
}

async function collectUrls(page) {
  const all = new Set();
  for (const base of LIST_URLS) {
    for (let pg = 1; pg <= MAX_PAGES; pg++) {
      const url = `${base}?page=${pg}`;
      try {
        const html = await gotoWithChallenge(page, url);
        const found = parseListHtml(html);
        let added = 0;
        for (const u of found) {
          if (!all.has(u)) {
            all.add(u);
            added += 1;
          }
        }
        console.log(`[URLS] page ${pg}: +${added} (total ${all.size})`);
        if (added === 0) break; // pagination exhausted
        if (all.size >= MAX_DETAILS * 2) break;
        await jitter();
      } catch (err) {
        console.warn(`[URLS] page ${pg} failed: ${err.message}`);
        if (pg === 1) break;
      }
    }
    if (all.size >= MAX_DETAILS * 2) break;
  }
  const sorted = [...all].sort(
    (a, b) => (parseHirdetesId(b) || 0) - (parseHirdetesId(a) || 0)
  );
  return sorted.slice(0, MAX_DETAILS);
}

async function main() {
  console.log(
    `[INIT] headless=${HEADLESS} maxPages=${MAX_PAGES} maxDetails=${MAX_DETAILS}`
  );
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  const context = await newStealthContext(browser);
  const page = await context.newPage();

  let records = [];
  try {
    const urls = await collectUrls(page);
    console.log(`[URLS] collected ${urls.length} listing URLs`);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const html = await gotoWithChallenge(page, url);
        const rec = parseDetailHtml(html, url);
        if (rec.listing_id && rec.title && !/csak egy gyors/i.test(rec.title)) {
          records.push(rec);
        } else {
          console.warn(`[DETAIL] suspicious record for ${url}, skipping`);
        }
        if ((i + 1) % 10 === 0) {
          console.log(`[DETAIL] ${i + 1}/${urls.length} done`);
        }
      } catch (err) {
        console.warn(`[DETAIL] ${url} failed: ${err.message}`);
      }
      await jitter();
    }
  } finally {
    await browser.close();
  }

  console.log(`[DB] upserting ${records.length} records`);
  let saved = 0;
  await withClient(async (client) => {
    for (const rec of records) {
      try {
        await upsertListing(client, rec);
        saved += 1;
      } catch (err) {
        console.warn(`[DB] upsert failed for ${rec.source_url}: ${err.message}`);
      }
    }
  });
  console.log(`[DONE] saved ${saved}/${records.length}`);
}

main().catch((err) => {
  console.error(`[FATAL] ${err.stack || err.message}`);
  process.exit(1);
});
