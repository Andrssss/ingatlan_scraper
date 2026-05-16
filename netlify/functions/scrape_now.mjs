import daily from "./scrape_daily.mjs";

export default async (req) => {
  console.log(`[AUTH] Testing mode: skipping authentication`);
  return daily(req);
};
