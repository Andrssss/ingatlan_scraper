import daily from "../netlify/functions/scrape_daily.mjs";

const res = await daily(new Request("http://localhost/internal"));
const text = await res.text();
console.log(res.status, text);
