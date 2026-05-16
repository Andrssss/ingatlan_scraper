import { chromium } from "playwright";
import { parseListHtml, parseHirdetesId } from "./netlify/functions/_scrape_core.mjs";
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled","--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  locale: "hu-HU", timezoneId: "Europe/Budapest",
  viewport: { width: 1366, height: 850 },
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator,"webdriver",{get:()=>undefined});
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
try {
  await page.goto("https://ingatlan.com/lista/elado+lakas+budapest", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(15000); // Wait for potential bypass on list page
  const html = await page.content();
  let urls = parseListHtml(html).filter(u => u.includes("ingatlan.com/") && !u.includes("ad.adverticum.net"));
  console.log("URLS_COUNT", urls.length);
  console.log("FIRST5", JSON.stringify(urls.slice(0,5)));
  console.log("IDS", urls.slice(0,5).map(parseHirdetesId));
  if (urls.length) {
    const targetUrl = urls[0];
    console.log("Navigating to:", targetUrl);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Aggressive wait for human verification/load
    for(let i=0; i<4; i++) {
        await page.mouse.move(Math.random()*400, Math.random()*400);
        await page.waitForTimeout(5000);
    }
    const dhtml = await page.content();
    const { parseDetailHtml } = await import("./netlify/functions/_scrape_core.mjs");
    const rec = parseDetailHtml(dhtml, targetUrl);
    console.log("REC_id=", rec.listing_id, "title=", rec.title?.substring(0,80), "price=", rec.price_text, "area=", rec.area_m2);
  }
} catch (err) {
  console.error(err);
} finally {
  await browser.close();
}
