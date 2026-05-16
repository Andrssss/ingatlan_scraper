import daily from "./scrape_daily.mjs";

export default async (req) => {
  const secret = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;
  
  // If CRON_SECRET is not configured, skip auth check (for testing)
  if (!cronSecret) {
    console.warn(`[AUTH] Warning: CRON_SECRET not configured in environment. Allowing scrape without authentication.`);
  } else if (secret !== cronSecret) {
    console.warn(`[AUTH] Secret mismatch or missing. Expected: ${cronSecret.substring(0, 5)}...`);
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  
  console.log(`[AUTH] Scrape allowed.`);
  return daily(req);
};
