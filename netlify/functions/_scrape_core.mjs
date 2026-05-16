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
  const out = [];
  console.log(`[URLS] Starting URL collection. maxPages=${maxPagesPerType}, sources=${LIST_URLS.length}`);

  for (const baseUrl of LIST_URLS) {
    console.log(`[URLS] Fetching from source: ${baseUrl.substring(0, 80)}...`);
    for (let page = 1; page <= maxPagesPerType; page++) {
      const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
      let html;
      try {
        console.log(`[URLS] Page ${page}: fetching...`);
        html = await fetchText(pageUrl);
        console.log(`[URLS] Page ${page}: OK (${html.length} bytes)`);
      } catch (err) {
        console.error(`[URLS] Page ${page} fetch failed: ${err.message}`);
        break;
      }

      if (isBotChallengeHtml(html)) {
        console.error(`[URLS] Page ${page}: Anti-bot challenge detected!`);
        throw new Error(`Source anti-bot challenge detected at ${pageUrl}`);
      }

      const $ = cheerioLoad(html);
      const links = new Set();

      $("a[href*='/']").each((_, a) => {
        const href = $(a).attr("href");
        const abs = toAbsUrl(href);
        const id = parseHirdetesId(abs);
        if (abs && id) links.add(`https://ingatlan.com/${id}`);
      });

      const pageUrls = [...links];
      console.log(`[URLS] Page ${page}: Found ${pageUrls.length} unique listing IDs`);

      out.push(...pageUrls);
      await jitter(1200, 3200);
    }
  }

  // dedupe, then newest first by numeric id
  const uniq = [...new Set(out)];
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
  const html = await fetchText(url);
  const $ = cheerioLoad(html);

  const id = parseHirdetesId(url);
  const title = clean($("h1").first().text()) || clean($("title").first().text());

  const propMap = getPropMap($);
  const ld = extractJsonLd($);

  const location =
    clean($("[data-testid='address']").first().text()) ||
    clean($(".address").first().text()) ||
    clean($("h1").first().next().text());

  const priceText =
    clean(propMap["ár"] || propMap["ar"]) ||
    clean($("[data-testid='price']").first().text()) ||
    clean($(".price").first().text()) ||
    clean(ld?.offers?.priceCurrency && ld?.offers?.price ? `${ld.offers.price} ${ld.offers.priceCurrency}` : "");

  const record = {
    source_url: `https://ingatlan.com/${id}`,
    listing_id: id,
    title,
    listing_type: detectType(title, propMap),
    location_text: location || null,
    district: extractDistrict(location),
    price_text: priceText || null,
    price_ft: parsePriceFt(priceText),
    area_m2: maybeNumFromText(propMap["alapterület"] || propMap["alapterulet"]),
    lot_m2: maybeNumFromText(propMap["telekterület"] || propMap["telekterulet"]),
    rooms_text: clean(propMap["szobák"] || propMap["szobak"]),
    ad_category: clean(title.split("-")[0] || title),
    condition_text: clean(propMap["ingatlan állapota"] || propMap["ingatlan allapota"]),
    build_year: maybeNumFromText(propMap["építés éve"] || propMap["epites eve"]),
    comfort: clean(propMap["komfort"]),
    floor: clean(propMap["emelet"]),
    building_floors: maybeNumFromText(propMap["épület szintjei"] || propMap["epulet szintjei"]),
    elevator: clean(propMap["lift"]),
    ceiling_height: clean(propMap["belmagasság"] || propMap["belmagassag"]),
    air_conditioning: clean(propMap["légkondicionáló"] || propMap["legkondicionalo"]),
    accessible: clean(propMap["akadálymentesített"] || propMap["akadalymentesitett"]),
    bath_wc: clean(propMap["fürdő és wc"] || propMap["furdo es wc"]),
    orientation: clean(propMap["tájolás"] || propMap["tajolas"]),
    view_text: clean(propMap["kilátás"] || propMap["kilatas"]),
    balcony_m2: maybeNumFromText(propMap["erkély mérete"] || propMap["erkely merete"]),
    garden_contact: clean(propMap["kertkapcsolatos"]),
    attic: clean(propMap["tetőtér"] || propMap["tetoter"]),
    parking: clean(propMap["parkolás"] || propMap["parkolas"]),
    parking_price_text: clean(propMap["parkolóhely ára"] || propMap["parkolohely ara"]),
    parking_price_ft: parsePriceFt(propMap["parkolóhely ára"] || propMap["parkolohely ara"]),
    scraped_at: new Date().toISOString(),
    raw_json: {
      ld,
      propMap,
    },
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
