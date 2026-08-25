// Same cohort metrics as fetch_all.mjs (weekly), but dimensioned by day instead of week — powers
// the day-level drill-down inside an expanded week row. Verified live against Adjust's Reports
// Service that day-dimensioned cohort metrics (roas_ad_dN, retention_rate_dN, lifetime_value_ad_dN)
// are fully supported, same as week-dimensioned.
import { writeFileSync } from "fs";
import { APPS, RAW_NETWORKS, CHANNEL_MAP, AD_REVENUE_SOURCES, DATE_PERIOD, fetchJSON } from "./common.mjs";

const RD = [0, 1, 3, 7, 14, 21, 30, 45, 60];
const RT = [1, 3, 7, 14, 21, 30, 45, 60];

const metrics = [
  "installs", "cost", "ad_revenue",
  ...RD.map(d => `roas_ad_d${d}`),
  ...RT.map(d => `retention_rate_d${d}`),
  ...RD.map(d => `lifetime_value_ad_d${d}`),
];

async function fetchApp(app) {
  const params = new URLSearchParams();
  params.set("ad_spend_mode", "mixed");
  params.set("app_token__in", app.token);
  params.set("date_period", DATE_PERIOD);
  params.set("dimensions", "day,os_name,network,campaign");
  params.set("metrics", metrics.join(","));
  params.set("ad_revenue_sources", AD_REVENUE_SOURCES);
  params.set("network__in", RAW_NETWORKS.join(","));
  const json = await fetchJSON(params);
  return json.rows || [];
}

const allRows = [];
for (const app of APPS) {
  console.log(`Fetching daily cohort for ${app.name}...`);
  const rows = await fetchApp(app);
  console.log(`  -> ${rows.length} rows`);
  for (const r of rows) {
    const channel = CHANNEL_MAP[r.network];
    if (!channel) continue;
    allRows.push({ app: app.name, ...r, channel });
  }
}

console.log("Total combined daily cohort rows:", allRows.length);
writeFileSync(new URL("./raw_daily_cohort_rows.json", import.meta.url), JSON.stringify(allRows));
console.log("Saved raw_daily_cohort_rows.json");
