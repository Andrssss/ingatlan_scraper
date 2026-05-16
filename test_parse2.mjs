import { chromium } from "playwright";
import { parseListHtml, parseDetailHtml } from "./netlify/functions/_scrape_core.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
function isBlocked(h){return /csak egy gyors|just a moment/i.test(h||"");}
async function gotoWithChallenge(page, url, maxWait=25000) {
  for (let a=1; a<=4; a++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const dl = Date.now() + maxWait;
    let html = await page.content();
    while (isBlocked(html) && Date.now() < dl) {
      await page.waitForTimeout(1500);
      html = await page.content();
    }
    if (!isBlocked(html)) return html;
    console.warn("CF still blocked attempt", a);
    await sleep(2000+a*1500);
  }
  throw new Error("CF not solved");
}

const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled","--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  locale: "hu-HU", timezoneId: "Europe/Budapest",
  viewport: { width: 1366, height: 850 },
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator,"webdriver",{get:()=>undefined});
  Object.defineProperty(navigator,"languages",{get:()=>["hu-HU","hu","en"]});
  Object.defineProperty(navigator,"plugins",{get:()=>[1,2,3,4,5]});
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();

const listHtml = await gotoWithChallenge(page, "https://ingatlan.com/lista/elado+lakas+budapest");
const urls = parseListHtml(listHtml);
console.log("URLS_COUNT", urls.length, "first3", urls.slice(0,3));

for (const u of urls.slice(0,3)) {
  try {
    const dhtml = await gotoWithChallenge(page, u);
    const rec = parseDetailHtml(dhtml, u);
    console.log("REC", rec.listing_id, "|", rec.title?.substring(0,60), "|", rec.price_text, "|", rec.area_m2, "m2 |", rec.location_text);
  } catch (e) {
    console.warn("FAIL", u, e.message);
  }
  await sleep(2000);
}
await browser.close();
