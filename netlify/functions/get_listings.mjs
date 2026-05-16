import { withClient } from "./_db.mjs";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async (req) => {
  try {
    const u = new URL(req.url);
    const q = u.searchParams;

    const limit = Math.min(Math.max(Number(q.get("limit") || 50), 1), 200);
    const offset = Math.max(Number(q.get("offset") || 0), 0);

    const where = [];
    const params = [];

    const listingType = q.get("listing_type");
    if (listingType) {
      params.push(listingType);
      where.push(`listing_type = $${params.length}`);
    }

    const district = q.get("district");
    if (district) {
      params.push(district.toUpperCase());
      where.push(`district = $${params.length}`);
    }

    const minPrice = num(q.get("min_price"));
    if (minPrice !== null) {
      params.push(minPrice);
      where.push(`price_ft >= $${params.length}`);
    }

    const maxPrice = num(q.get("max_price"));
    if (maxPrice !== null) {
      params.push(maxPrice);
      where.push(`price_ft <= $${params.length}`);
    }

    const minArea = num(q.get("min_area"));
    if (minArea !== null) {
      params.push(minArea);
      where.push(`area_m2 >= $${params.length}`);
    }

    const maxArea = num(q.get("max_area"));
    if (maxArea !== null) {
      params.push(maxArea);
      where.push(`area_m2 <= $${params.length}`);
    }

    const hasLift = q.get("has_lift");
    if (hasLift === "1") {
      where.push(`lower(coalesce(elevator, '')) LIKE '%van%'`);
    }

    const condition = q.get("condition");
    if (condition) {
      params.push(`%${condition.toLowerCase()}%`);
      where.push(`lower(coalesce(condition_text, '')) LIKE $${params.length}`);
    }

    const search = q.get("search");
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where.push(`(
        lower(coalesce(title, '')) LIKE $${params.length}
        OR lower(coalesce(location_text, '')) LIKE $${params.length}
        OR lower(coalesce(parking, '')) LIKE $${params.length}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await withClient((client) =>
      client.query(
        `SELECT
          listing_id,
          source_url,
          title,
          listing_type,
          location_text,
          district,
          price_text,
          price_ft,
          area_m2,
          lot_m2,
          rooms_text,
          condition_text,
          build_year,
          comfort,
          floor,
          building_floors,
          elevator,
          air_conditioning,
          balcony_m2,
          parking,
          parking_price_text,
          scraped_at,
          last_seen
        FROM ingatlan_listings
        ${whereSql}
        ORDER BY listing_id DESC
        LIMIT ${limit} OFFSET ${offset}`,
        params
      )
    );

    return new Response(
      JSON.stringify({ ok: true, count: result.rowCount, items: result.rows }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
