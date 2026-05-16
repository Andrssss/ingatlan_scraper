import { withClient } from "./_db.mjs";
import { scrapeBatch } from "./_scrape_core.mjs";

export async function upsertListing(client, rec) {
  await client.query(
    `INSERT INTO ingatlan_listings (
      source_url, listing_id, title, listing_type, location_text, district,
      price_text, price_ft, area_m2, lot_m2, rooms_text,
      ad_category, condition_text, build_year, comfort,
      floor, building_floors, elevator, ceiling_height, air_conditioning,
      accessible, bath_wc, orientation, view_text, balcony_m2,
      garden_contact, attic, parking, parking_price_text, parking_price_ft,
      scraped_at, raw_json, first_seen, last_seen
    ) VALUES (
      $1,$2,$3,$4,$5,$6,
      $7,$8,$9,$10,$11,
      $12,$13,$14,$15,
      $16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,
      $26,$27,$28,$29,$30,
      NOW(),$31::jsonb,NOW(),NOW()
    )
    ON CONFLICT (listing_id) DO UPDATE SET
      source_url = EXCLUDED.source_url,
      title = EXCLUDED.title,
      listing_type = EXCLUDED.listing_type,
      location_text = EXCLUDED.location_text,
      district = EXCLUDED.district,
      price_text = EXCLUDED.price_text,
      price_ft = EXCLUDED.price_ft,
      area_m2 = EXCLUDED.area_m2,
      lot_m2 = EXCLUDED.lot_m2,
      rooms_text = EXCLUDED.rooms_text,
      ad_category = EXCLUDED.ad_category,
      condition_text = EXCLUDED.condition_text,
      build_year = EXCLUDED.build_year,
      comfort = EXCLUDED.comfort,
      floor = EXCLUDED.floor,
      building_floors = EXCLUDED.building_floors,
      elevator = EXCLUDED.elevator,
      ceiling_height = EXCLUDED.ceiling_height,
      air_conditioning = EXCLUDED.air_conditioning,
      accessible = EXCLUDED.accessible,
      bath_wc = EXCLUDED.bath_wc,
      orientation = EXCLUDED.orientation,
      view_text = EXCLUDED.view_text,
      balcony_m2 = EXCLUDED.balcony_m2,
      garden_contact = EXCLUDED.garden_contact,
      attic = EXCLUDED.attic,
      parking = EXCLUDED.parking,
      parking_price_text = EXCLUDED.parking_price_text,
      parking_price_ft = EXCLUDED.parking_price_ft,
      raw_json = EXCLUDED.raw_json,
      scraped_at = NOW(),
      last_seen = NOW();`,
    [
      rec.source_url, rec.listing_id, rec.title, rec.listing_type, rec.location_text, rec.district,
      rec.price_text, rec.price_ft, rec.area_m2, rec.lot_m2, rec.rooms_text,
      rec.ad_category, rec.condition_text, rec.build_year, rec.comfort,
      rec.floor, rec.building_floors, rec.elevator, rec.ceiling_height, rec.air_conditioning,
      rec.accessible, rec.bath_wc, rec.orientation, rec.view_text, rec.balcony_m2,
      rec.garden_contact, rec.attic, rec.parking, rec.parking_price_text, rec.parking_price_ft,
      JSON.stringify(rec.raw_json || {}),
    ]
  );
}

async function runScrape() {
  const maxPagesPerType = Number(process.env.SCRAPE_MAX_PAGES_PER_TYPE || 20);
  const maxDetails = Number(process.env.SCRAPE_MAX_DETAILS || 500);

  console.log(`[SCRAPE] Starting batch. maxPages=${maxPagesPerType}, maxDetails=${maxDetails}`);

  let records = [];
  try {
    records = await scrapeBatch({
      maxPagesPerType,
      maxDetails,
      minDelayMs: Number(process.env.SCRAPE_MIN_DELAY_MS || 1800),
      maxDelayMs: Number(process.env.SCRAPE_MAX_DELAY_MS || 6500),
    });
    console.log(`[SCRAPE] Batch complete. Collected ${records.length} records.`);
  } catch (err) {
    console.error(`[SCRAPE] Batch failed: ${err.message}`);
    throw err;
  }

  let saved = 0;
  console.log(`[DB] Starting upsert of ${records.length} records.`);
  try {
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
    console.log(`[DB] Upsert complete. Saved ${saved}/${records.length}.`);
  } catch (err) {
    console.error(`[DB] Database connection or query failed: ${err.message}`);
    throw err;
  }

  return { scanned: records.length, saved };
}

export const config = {
  schedule: "0 3 * * *",
};

export default async () => {
  try {
    const result = await runScrape();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
