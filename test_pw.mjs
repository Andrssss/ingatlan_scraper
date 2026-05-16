import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled","--no-sandbox"] });
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  locale: "hu-HU", timezoneId: "Europe/Budapest",
  viewport: { width: 1366, height: 850 },
  extraHTTPHeaders: { "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.8" },
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator,"webdriver",{get:()=>undefined});
  Object.defineProperty(navigator,"languages",{get:()=>["hu-HU","hu","en"]});
  Object.defineProperty(navigator,"plugins",{get:()=>[1,2,3,4,5]});
  window.chrome = { runtime: {} };
});
const page = await ctx.newPage();
try {
  await page.goto("https://ingatlan.com/lista/elado+lakas+budapest", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(10000);
  const html = await page.content();
  const blocked = html.toLowerCase().includes("csak egy gyors");
  const hasFt = html.includes("M Ft") || html.includes("millió Ft") || html.includes("Ft</");
  console.log("LEN", html.length, "blocked=", blocked, "hasFt=", hasFt);
  const links = await page.$$eval("a[href*='/']", as => as.map(a=>a.getAttribute("href")).filter(h=>h && /\/\d{7,}/.test(h)).slice(0,5));
  console.log("SAMPLE_LINKS", JSON.stringify(links));
} catch (e) {
  console.error("PAGE_ERR", e.message);
} finally {
  await browser.close();
}
