import { writeFileSync } from "fs";
import { APPS, RAW_NETWORKS, CHANNEL_MAP, AD_REVENUE_SOURCES, DATE_PERIOD, fetchJSON } from "./common.mjs";

async function fetchApp(app) {
  const params = new URLSearchParams();
  params.set("ad_spend_mode", "mixed");
  params.set("app_token__in", app.token);
  params.set("date_period", DATE_PERIOD);
  params.set("dimensions", "day,os_name,network,campaign");
  params.set("metrics", "installs,cost,ad_revenue");
  params.set("ad_revenue_sources", AD_REVENUE_SOURCES);
  params.set("network__in", RAW_NETWORKS.join(","));
  const json = await fetchJSON(params);
  return json.rows || [];
}

const allRows = [];
for (const app of APPS) {
  console.log(`Fetching daily actuals for ${app.name}...`);
  const rows = await fetchApp(app);
  console.log(`  -> ${rows.length} rows`);
  for (const r of rows) {
    const channel = CHANNEL_MAP[r.network];
    if (!channel) continue;
    allRows.push({ app: app.name, ...r, channel });
  }
}

console.log("Total combined daily rows:", allRows.length);
writeFileSync(new URL("./raw_daily_rows.json", import.meta.url), JSON.stringify(allRows));
console.log("Saved raw_daily_rows.json");
