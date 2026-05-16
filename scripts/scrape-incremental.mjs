// Daily incremental scraper using ScrapingBee API.
// Fetches only listings not yet stored in the DB → credit-efficient.
//
// Required env:
//   SCRAPINGBEE_API_KEY
//   DATABASE_URL or NETLIFY_DATABASE_URL
//
// Optional env:
//   SCRAPINGBEE_STEALTH    "true" (default) stealth_proxy=true (75 cr/req, reliable)
//                          "false" = premium_proxy (10 cr/req, may fail on CF Turnstile)
//   SCRAPE_MAX_NEW         max new listing details to fetch per run (default 30)
//   SCRAPE_MAX_LIST_PAGES  max list pages to check per URL source (default 3)
//
// Estimated credits per run (STEALTH=true):
//   List pages:  2 sources × up to 3 pages × 75 = up to 450 cr
//   Details:     new listings × 75  (typically 3–10/day = 225–750 cr)
//   Normal day total: ~300–800 cr  →  use your 1000 free cr sparingly, then $29/mo plan
//
// One-time FULL scrape → run locally: npm run scrape:playwright  (residential IP, free)

import https from "https";
import zlib from "zlib";
import { withClient } from "../netlify/functions/_db.mjs";
import { upsertListing } from "../netlify/functions/scrape_daily.mjs";
import {
  parseListHtml,
  parseDetailHtml,
  parseHirdetesId,
} from "../netlify/functions/_scrape_core.mjs";

const API_KEY = process.env.SCRAPINGBEE_API_KEY;
if (!API_KEY) {
  console.error("[FATAL] SCRAPINGBEE_API_KEY env var is required");
  process.exit(1);
}

const STEALTH = String(process.env.SCRAPINGBEE_STEALTH ?? "true") !== "false";
const MAX_NEW = Number(process.env.SCRAPE_MAX_NEW || 30);
const MAX_LIST_PAGES = Number(process.env.SCRAPE_MAX_LIST_PAGES || 3);

const LIST_URLS = [
  "https://ingatlan.com/lista/elado+lakas+i-ker+ii-ker+iii-ker+iv-ker+ix-ker+v-ker+vi-ker+vii-ker+viii-ker+x-ker+xi-ker+xii-ker+xiii-ker+xiv-ker+xix-ker+xv-ker+xvi-ker+xvii-ker+xviii-ker+xx-ker+xxi-ker+xxii-ker+xxiii-ker",
  "https://ingatlan.com/lista/elado+haz+i-ker+ii-ker+iii-ker+iv-ker+ix-ker+v-ker+vi-ker+vii-ker+viii-ker+x-ker+xi-ker+xii-ker+xiii-ker+xiv-ker+xix-ker+xv-ker+xvi-ker+xvii-ker+xviii-ker+xx-ker+xxi-ker+xxii-ker+xxiii-ker",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => sleep(800 + Math.floor(Math.random() * 1500));

// ── ScrapingBee fetch ─────────────────────────────────────────────────────────

function buildSbUrl(targetUrl) {
  const params = new URLSearchParams({
    api_key: API_KEY,
    url: targetUrl,
    render_js: "true",
    wait: "2000",
    ...(STEALTH
      ? { stealth_proxy: "true" }
      : { premium_proxy: "true", country_code: "hu" }),
  });
  return `https://app.scrapingbee.com/api/v1/?${params}`;
}

function fetchSB(targetUrl) {
  return new Promise((resolve, reject) => {
    const apiUrl = new URL(buildSbUrl(targetUrl));
    const req = https.request(
      apiUrl,
      { method: "GET", timeout: 90000 },
      (res) => {
        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        let stream = res;
        if (enc.includes("gzip")) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());
        else if (enc.includes("deflate")) stream = res.pipe(zlib.createInflate());

        let data = "";
        stream.setEncoding("utf8");
        stream.on("data", (c) => (data += c));
        stream.on("end", () => {
          const code = res.statusCode || 0;
          // ScrapingBee returns 200 even for proxied non-200 pages;
          // check residual CF challenge in body.
          if (data.toLowerCase().includes("csak egy gyors ellen")) {
            return reject(new Error(`CF challenge not resolved by ScrapingBee for ${targetUrl}`));
          }
          if (code >= 200 && code < 300) return resolve(data);
          reject(new Error(`ScrapingBee HTTP ${code} for ${targetUrl}: ${data.substring(0, 300)}`));
        });
        stream.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Timeout: ${targetUrl}`)));
    req.on("error", reject);
    req.end();
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getKnownIds() {
  const ids = new Set();
  await withClient(async (client) => {
    const res = await client.query(
      "SELECT listing_id FROM ingatlan_listings WHERE listing_id IS NOT NULL"
    );
    for (const row of res.rows) ids.add(Number(row.listing_id));
  });
  return ids;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const creditMode = STEALTH ? "stealth (75 cr/req)" : "premium (10 cr/req)";
  console.log(
    `[INIT] mode=${creditMode} maxNew=${MAX_NEW} maxListPages=${MAX_LIST_PAGES}`
  );

  // 1. Load known IDs from DB
  const knownIds = await getKnownIds();
  console.log(`[DB] ${knownIds.size} known listing IDs`);

  // 2. Collect new listing URLs from list pages
  const newUrls = [];

  for (const base of LIST_URLS) {
    for (let pg = 1; pg <= MAX_LIST_PAGES; pg++) {
      const url = `${base}?page=${pg}`;
      try {
        console.log(`[LIST] fetching ${url.substring(0, 60)}...?page=${pg}`);
        const html = await fetchSB(url);
        const found = parseListHtml(html);
        const newOnPage = found.filter(
          (u) => !knownIds.has(parseHirdetesId(u))
        );
        console.log(
          `[LIST] page ${pg}: ${found.length} total, ${newOnPage.length} new`
        );

        for (const u of newOnPage) {
          if (!newUrls.includes(u)) newUrls.push(u);
        }

        // No new items on this page → we're caught up, stop paging
        if (newOnPage.length === 0) break;
        if (newUrls.length >= MAX_NEW) break;

        await jitter();
      } catch (err) {
        console.warn(`[LIST] page ${pg} failed: ${err.message}`);
        if (pg === 1) break; // first page fail → skip this source
      }
    }
    if (newUrls.length >= MAX_NEW) break;
  }

  const toFetch = newUrls.slice(0, MAX_NEW);
  console.log(`[DETAIL] fetching ${toFetch.length} new listings`);

  if (toFetch.length === 0) {
    console.log("[DONE] nothing new, exiting");
    return;
  }

  // 3. Fetch detail pages for new listings
  const records = [];
  for (let i = 0; i < toFetch.length; i++) {
    const url = toFetch[i];
    try {
      const html = await fetchSB(url);
      const rec = parseDetailHtml(html, url);
      if (rec.listing_id) {
        records.push(rec);
        console.log(
          `[DETAIL] ${i + 1}/${toFetch.length} ✓ ${rec.listing_id} ${rec.title?.substring(0, 50)} | ${rec.price_text}`
        );
      }
    } catch (err) {
      console.warn(`[DETAIL] ${url} failed: ${err.message}`);
    }
    await jitter();
  }

  // 4. Upsert to DB
  console.log(`[DB] upserting ${records.length} records`);
  let saved = 0;
  await withClient(async (client) => {
    for (const rec of records) {
      try {
        await upsertListing(client, rec);
        saved++;
      } catch (err) {
        console.warn(`[DB] upsert failed ${rec.source_url}: ${err.message}`);
      }
    }
  });

  const estCredits =
    (Math.min(MAX_LIST_PAGES, 3) * LIST_URLS.length + toFetch.length) *
    (STEALTH ? 75 : 10);
  console.log(
    `[DONE] saved=${saved}/${records.length} | estimated credits used: ~${estCredits}`
  );
}

main().catch((err) => {
  console.error(`[FATAL] ${err.stack || err.message}`);
  process.exit(1);
});
