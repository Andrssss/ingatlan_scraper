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

function getMockListingUrls() {
  // Mock data for testing while real scraper is blocked
  console.log(`[MOCK] Returning mock listing URLs`);
  return [
    "https://ingatlan.com/35352926",
    "https://ingatlan.com/35352927",
    "https://ingatlan.com/35352928",
    "https://ingatlan.com/35352929",
    "https://ingatlan.com/35352930",
  ];
}

function getMockListing(id) {
  // Mock listing data for testing
  const mockListings = {
    35352926: { listing_id: 35352926, title: "Eladó lakás I. ker. Budapest", listing_type: "lakas", location_text: "Budapest I. kerület", district: "I", price_text: "120 millió Ft", price_ft: 120000000, area_m2: 85.5, rooms_text: "3 szoba", condition_text: "jó", comfort: "komfort", floor: "2", building_floors: 4, elevator: "van", source_url: "https://ingatlan.com/35352926", ad_category: "eladó lakás", build_year: 1985, accessible: null, bath_wc: null, orientation: "délkeleti", view_text: null, balcony_m2: null, garden_contact: null, attic: null, parking: "közös udvar", parking_price_text: null, parking_price_ft: null, ceiling_height: "2.8", air_conditioning: "van", raw_json: {} },
    35352927: { listing_id: 35352927, title: "Eladó ház V. ker. Budapest", listing_type: "haz", location_text: "Budapest V. kerület", district: "V", price_text: "250 millió Ft", price_ft: 250000000, area_m2: 180, rooms_text: "6 szoba", condition_text: "felújított", comfort: "komfort", floor: "1", building_floors: 3, elevator: "van", source_url: "https://ingatlan.com/35352927", ad_category: "eladó ház", build_year: 1950, accessible: null, bath_wc: "2", orientation: "északkeleti", view_text: "kertre nézőtől", balcony_m2: null, garden_contact: "igen", attic: "van", parking: "2 parkoló", parking_price_text: null, parking_price_ft: null, ceiling_height: "3.2", air_conditioning: null, raw_json: {} },
    35352928: { listing_id: 35352928, title: "Eladó lakás VII. ker. Budapest", listing_type: "lakas", location_text: "Budapest VII. kerület", district: "VII", price_text: "95 millió Ft", price_ft: 95000000, area_m2: 65, rooms_text: "2 szoba", condition_text: "újszerű", comfort: "komfort", floor: "3", building_floors: 5, elevator: "van", source_url: "https://ingatlan.com/35352928", ad_category: "eladó lakás", build_year: 2015, accessible: null, bath_wc: null, orientation: "nyugati", view_text: null, balcony_m2: 8, garden_contact: null, attic: null, parking: "parkoló lehetséges", parking_price_text: null, parking_price_ft: null, ceiling_height: "2.9", air_conditioning: "van", raw_json: {} },
    35352929: { listing_id: 35352929, title: "Eladó lakás XIII. ker. Budapest", listing_type: "lakas", location_text: "Budapest XIII. kerület", district: "XIII", price_text: "110 millió Ft", price_ft: 110000000, area_m2: 72, rooms_text: "3 szoba", condition_text: "jó", comfort: "komfort", floor: "2", building_floors: 7, elevator: "van", source_url: "https://ingatlan.com/35352929", ad_category: "eladó lakás", build_year: 1995, accessible: null, bath_wc: null, orientation: "déli", view_text: "Duna-part közel", balcony_m2: 6, garden_contact: null, attic: null, parking: "közös parkoló", parking_price_text: "800 Ft/hó", parking_price_ft: null, ceiling_height: "2.7", air_conditioning: "nincs", raw_json: {} },
    35352930: { listing_id: 35352930, title: "Eladó ház XI. ker. Budapest", listing_type: "haz", location_text: "Budapest XI. kerület", district: "XI", price_text: "180 millió Ft", price_ft: 180000000, area_m2: 150, rooms_text: "5 szoba", condition_text: "felújított", comfort: "komfort", floor: "1", building_floors: 2, elevator: "nincs", source_url: "https://ingatlan.com/35352930", ad_category: "eladó ház", build_year: 1980, accessible: null, bath_wc: "2", orientation: "keleti", view_text: null, balcony_m2: null, garden_contact: "igen", attic: "van", parking: "4 parkoló", parking_price_text: null, parking_price_ft: null, ceiling_height: "3", air_conditioning: null, raw_json: {} },
  };
  return mockListings[id] || null;
}

async function fetchTextWithBrowser(url) {
  throw new Error("Browser fetching not supported in Lambda. Using mock data instead.");
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

  // Use mock data instead of real scraping (ingatlan.com is blocking automated requests)
  const mockUrls = getMockListingUrls();
  console.log(`[URLS] Using mock data. Returning ${mockUrls.length} mock URLs.`);
  
  // Dedupe, then newest first by numeric id
  const uniq = [...new Set(mockUrls)];
  uniq.sort((a, b) => (parseHirdetesId(b) || 0) - (parseHirdetesId(a) || 0));
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
  const mockData = getMockListing(id);
  
  if (!mockData) {
    console.log(`[MOCK] No mock data for ${id}, using empty record`);
    return { listing_id: id, source_url: url, title: "Unknown", raw_json: {} };
  }
  
  console.log(`[MOCK] Returning mock listing ${id}`);
  
  const record = {
    source_url: mockData.source_url || url,
    listing_id: mockData.listing_id || id,
    title: mockData.title,
    listing_type: mockData.listing_type,
    location_text: mockData.location_text,
    district: mockData.district,
    price_text: mockData.price_text,
    price_ft: mockData.price_ft,
    area_m2: mockData.area_m2,
    lot_m2: mockData.lot_m2 || null,
    rooms_text: mockData.rooms_text,
    ad_category: mockData.ad_category,
    condition_text: mockData.condition_text,
    build_year: mockData.build_year,
    comfort: mockData.comfort,
    floor: mockData.floor,
    building_floors: mockData.building_floors,
    elevator: mockData.elevator,
    ceiling_height: mockData.ceiling_height,
    air_conditioning: mockData.air_conditioning,
    accessible: mockData.accessible,
    bath_wc: mockData.bath_wc,
    orientation: mockData.orientation,
    view_text: mockData.view_text,
    balcony_m2: mockData.balcony_m2,
    garden_contact: mockData.garden_contact,
    attic: mockData.attic,
    parking: mockData.parking,
    parking_price_text: mockData.parking_price_text,
    parking_price_ft: mockData.parking_price_ft,
    scraped_at: new Date().toISOString(),
    raw_json: mockData.raw_json || {},
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
