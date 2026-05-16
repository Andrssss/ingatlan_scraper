import https from "https";
import http from "http";
import zlib from "zlib";
import { load as cheerioLoad } from "cheerio";

const LIST_URLS = [
  "https://ingatlan.com/lista/elado+lakas+i-ker+ii-ker+iii-ker+iv-ker+ix-ker+v-ker+vi-ker+vii-ker+viii-ker+x-ker+xi-ker+xii-ker+xiii-ker+xiv-ker+xix-ker+xv-ker+xvi-ker+xvii-ker+xviii-ker+xx-ker+xxi-ker+xxii-ker+xxiii-ker",
  "https://ingatlan.com/lista/elado+haz+i-ker+ii-ker+iii-ker+iv-ker+ix-ker+v-ker+vi-ker+vii-ker+viii-ker+x-ker+xi-ker+xii-ker+xiii-ker+xiv-ker+xix-ker+xv-ker+xvi-ker+xvii-ker+xviii-ker+xx-ker+xxi-ker+xxii-ker+xxiii-ker",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(minMs = 1200, maxMs = 4200) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(ms);
}

export function parseHirdetesId(url) {
  const m = String(url).match(/ingatlan\.com\/(\d+)/i);
  return m ? Number(m[1]) : null;
}

function toAbsUrl(href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `https://ingatlan.com${href}`;
  return `https://ingatlan.com/${href}`;
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function isBotChallengeHtml(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("csak egy gyors ellen\u0151rz\u00e9s") ||
    s.includes("just a quick check") ||
    s.includes("cloudflare") ||
    s.includes("captcha")
  );
}

function fetchText(url, redirectLeft = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;

    const req = lib.request(
      u,
      {
        method: "GET",
        headers: {
          "User-Agent": pickUA(),
          "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8",
          "Accept-Encoding": "gzip,deflate,br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        timeout: 30000,
      },
      (res) => {
        const code = res.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(code)) {
          const loc = res.headers.location;
          if (!loc) return reject(new Error(`HTTP ${code} no Location: ${url}`));
          if (redirectLeft <= 0) return reject(new Error(`Too many redirects: ${url}`));
          const nextUrl = new URL(loc, url).toString();
          res.resume();
          return resolve(fetchText(nextUrl, redirectLeft - 1));
        }

        if (code === 403 || code === 429) {
          res.resume();
          return reject(new Error(`Blocked or rate-limited: HTTP ${code} for ${url}`));
        }

        const enc = String(res.headers["content-encoding"] || "").toLowerCase();
        let stream = res;
        if (enc.includes("gzip")) stream = res.pipe(zlib.createGunzip());
        else if (enc.includes("deflate")) stream = res.pipe(zlib.createInflate());
        else if (enc.includes("br")) stream = res.pipe(zlib.createBrotliDecompress());

        let data = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          data += chunk;
        });
        stream.on("end", () => {
          if (code >= 200 && code < 300) resolve(data);
          else reject(new Error(`HTTP ${code} for ${url}`));
        });
        stream.on("error", reject);
      }
    );

    req.on("timeout", () => req.destroy(new Error(`Timeout for ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

export async function collectListingUrls({ maxPagesPerType = 10 } = {}) {
  console.log(`[URLS] Starting URL collection. maxPages=${maxPagesPerType}, sources=${LIST_URLS.length}`);
  const urls = [];

  for (const baseUrl of LIST_URLS) {
    console.log(`[URLS] Scraping ${baseUrl.substring(0, 50)}...`);
    for (let page = 1; page <= maxPagesPerType; page++) {
      const url = `${baseUrl}?page=${page}`;
      try {
        const html = await fetchText(url);
        const $ = cheerioLoad(html);

        // Parse listing links
        $("a[href*='/']").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          const id = parseHirdetesId(href);
          if (id) {
            const absUrl = toAbsUrl(href);
            if (!urls.includes(absUrl)) {
              urls.push(absUrl);
            }
          }
        });

        console.log(`[URLS] Page ${page}: Found ${urls.length} URLs so far.`);

        if (urls.length >= 500) {
          console.log(`[URLS] Reached 500 URLs, stopping collection.`);
          break;
        }

        await jitter(2000, 5000);
      } catch (err) {
        console.warn(`[URLS] Page ${page} failed: ${err.message}`);
        if (page === 1) throw err; // Fail on first page, continue on others
      }
    }
    if (urls.length >= 500) break;
  }

  // Dedupe and sort by ID (newest first)
  const uniq = [...new Set(urls)];
  uniq.sort((a, b) => (parseHirdetesId(b) || 0) - (parseHirdetesId(a) || 0));
  console.log(`[URLS] Collection complete. Total ${uniq.length} URLs collected.`);
  return uniq;
}

function getPropMap($) {
  const map = {};
  // Generic dt/dd style
  $("dt").each((_, dt) => {
    const k = clean($(dt).text()).toLowerCase();
    const v = clean($(dt).next("dd").text());
    if (k && v) map[k] = v;
  });
  // Fallback: inline label-value blocks
  $("*").each((_, el) => {
    const text = clean($(el).text());
    if (!text || text.length > 120) return;
    if (text.endsWith(":")) {
      const k = clean(text.slice(0, -1)).toLowerCase();
      const v = clean($(el).next().text());
      if (k && v && !map[k]) map[k] = v;
    }
  });
  return map;
}

function extractJsonLd($) {
  const chunks = [];
  $("script[type='application/ld+json']").each((_, s) => {
    const raw = $(s).contents().text();
    if (raw) chunks.push(raw);
  });
  for (const raw of chunks) {
    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : [data];
      for (const obj of arr) {
        if (!obj || typeof obj !== "object") continue;
        if (obj["@type"] === "Product" || obj["@type"] === "Residence" || obj["@type"] === "Offer") {
          return obj;
        }
      }
    } catch {
      // ignore malformed jsonld
    }
  }
  return null;
}

function parsePriceFt(priceText) {
  const s = clean(priceText).toLowerCase();
  if (!s) return null;

  const num = Number(s.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(num)) return null;

  if (s.includes("millio") || s.includes("m ft") || s.includes("mft")) {
    return Math.round(num * 1_000_000);
  }
  if (s.includes("ezer")) {
    return Math.round(num * 1_000);
  }
  return Math.round(num);
}

function detectType(title, props) {
  const t = clean(title).toLowerCase();
  const kind = clean(props["ingatlan típusa"] || props["ingatlan tipusa"] || "").toLowerCase();
  if (t.includes("haz") || kind.includes("haz")) return "haz";
  return "lakas";
}

function maybeNumFromText(v) {
  if (!v) return null;
  const m = String(v).match(/-?\d+[\d\s.,]*/);
  if (!m) return null;
  const n = Number(m[0].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function extractDistrict(locationText) {
  const s = clean(locationText).toLowerCase();
  const m = s.match(/([ivxlcdm]+|\d+)\.\s*ker/i);
  if (m) return m[1].toUpperCase();
  return null;
}

export async function scrapeListing(url) {
  const id = parseHirdetesId(url);
  if (!id) throw new Error(`Cannot extract ID from ${url}`);

  console.log(`[SCRAPE] Fetching ${url}`);
  const html = await fetchText(url);
  const $ = cheerioLoad(html);

  // Extract title
  const title = clean($("h1").first().text() || $("title").text());

  // Extract property map from dt/dd or labels
  const props = getPropMap($);

  // Extract JSON-LD for structured data
  const jsonLd = extractJsonLd($) || {};

  // Parse fields
  const priceText = clean(
    props["ár"] || props["ar"] || jsonLd.price || jsonLd.offers?.[0]?.price || ""
  );
  const price_ft = parsePriceFt(priceText);

  const areaText = clean(props["terület"] || props["terulet"] || jsonLd.floorSize || "");
  const area_m2 = maybeNumFromText(areaText);

  const roomsText = clean(props["szobák"] || props["szobak"] || props["szoba"] || "");
  const listingType = detectType(title, props);
  const location = clean(props["település"] || props["telepules"] || props["hely"] || "");
  const district = extractDistrict(location);

  const conditionText = clean(props["állapot"] || props["allapot"] || "");
  const build_year = maybeNumFromText(props["építés éve"] || props["epites eve"] || "");
  const comfort = clean(props["komfort"] || "komfort");
  const floor = clean(props["szint"] || props["szint/szintek"] || "");
  const building_floors = maybeNumFromText(props["szintek száma"] || props["szintek szama"] || "");
  const elevator = clean(props["lift"] || props["felvonó"] || props["felvonom"] || "");
  const ceiling_height = clean(props["belmagasság"] || props["belmagassag"] || "");
  const air_conditioning = clean(props["légkondicionálás"] || props["legkondicionalis"] || "");
  const accessible = clean(props["akadálymentesített"] || props["akadalymentsitett"] || null);
  const bath_wc = clean(props["fürdő, wc"] || props["furdo wc"] || "");
  const orientation = clean(props["kitárulás"] || props["kitarulas"] || "");
  const view_text = clean(props["kilátás"] || props["kilatas"] || "");
  const balcony_m2 = maybeNumFromText(props["erkély"] || props["erkely"] || "");
  const garden_contact = clean(props["kert"] || "");
  const attic = clean(props["tetőtér"] || props["tetoster"] || "");
  const parking = clean(props["parkolás"] || props["parkolas"] || "");
  const parking_price_text = clean(props["parkolás ára"] || props["parkolas ara"] || "");

  const record = {
    source_url: url,
    listing_id: id,
    title,
    listing_type: listingType,
    location_text: location,
    district,
    price_text: priceText,
    price_ft,
    area_m2,
    rooms_text: roomsText,
    ad_category: clean($("meta[property='og:type']").attr("content") || ""),
    condition_text: conditionText,
    build_year,
    comfort,
    floor,
    building_floors,
    elevator,
    ceiling_height,
    air_conditioning,
    accessible,
    bath_wc,
    orientation,
    view_text,
    balcony_m2,
    garden_contact: garden_contact ? "igen" : null,
    attic,
    parking,
    parking_price_text,
    parking_price_ft: null,
    scraped_at: new Date().toISOString(),
    raw_json: jsonLd,
  };

  return record;
}

export async function scrapeBatch({
  maxPagesPerType = 20,
  maxDetails = 500,
  minDelayMs = 1600,
  maxDelayMs = 5600,
  logger = console,
} = {}) {
  const urls = await collectListingUrls({ maxPagesPerType });
  if (urls.length === 0) {
    throw new Error("No listing URLs collected; source is likely blocking automated requests.");
  }
  console.log(`[URLS] Collection complete. Total ${urls.length} URLs collected from ${LIST_URLS.length} sources.`);
  const picked = urls.slice(0, maxDetails);
  const records = [];

  logger.log(`Collected ${urls.length} listing URLs, processing ${picked.length}.`);

  for (const url of picked) {
    try {
      const rec = await scrapeListing(url);
      if (rec.listing_id) records.push(rec);
    } catch (err) {
      logger.warn(`detail fetch failed: ${url} -> ${err.message}`);
    }
    await jitter(minDelayMs, maxDelayMs);
  }

  records.sort((a, b) => (b.listing_id || 0) - (a.listing_id || 0));
  return records;
}
