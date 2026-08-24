// Retool JS Query named: buildDataset
// Depends on: fetchAllWeekly, fetchAllDaily, fetchAllDailyCohort, pullRange (all should have
// run already). Ported verbatim from build_dataset.mjs — same merge/aggregation logic, same
// output shape that dashboard.js already expects (this is the exact object to bind into the
// Custom Component's Model as `dataset`).

const raw = fetchAllWeekly.data;
const rawDaily = fetchAllDaily.data;
const rawDailyCohort = fetchAllDailyCohort.data;

const APPS = ["Nova Solitaire", "Nut Sort", "Seek & Find", "Zen Solitaire"];
const CHANNELS = [
  "App Samurai", "Cashcow", "Edge226", "Influence Mobile", "KashKick", "Kickcash",
  "Mistplay", "Play2Pay", "Playback Rewards", "Playio", "Pogo", "Prodege",
  "Tapjoy", "TaurusX", "Tyrads", "Tyrads New", "benjamin", "exmox",
];
const RD = [0, 1, 3, 7, 14, 21, 30];
const RT = [1, 3, 7, 14, 21, 30];

const appIdx = Object.fromEntries(APPS.map((a, i) => [a, i]));
const chIdx = Object.fromEntries(CHANNELS.map((c, i) => [c, i]));

const weekSet = new Map();
const campaignList = [];
const campaignIdx = new Map();

function getCampaignIdx(name) {
  if (!campaignIdx.has(name)) {
    campaignIdx.set(name, campaignList.length);
    campaignList.push(name);
  }
  return campaignIdx.get(name);
}

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------------- weekly cohort rows ---------------- */
const rows = [];
let skipped = 0;

for (const r of raw) {
  const ai = appIdx[r.app];
  const ci = chIdx[r.channel];
  if (ai === undefined || ci === undefined) { skipped++; continue; }

  const os = r.os_name === "ios" ? 1 : 0;

  const [wStart, wEnd] = r.week.split(" - ");
  const wKey = `${wStart}|${wEnd}`;
  if (!weekSet.has(wKey)) weekSet.set(wKey, { start: wStart, end: wEnd });

  const campIdx = getCampaignIdx(r.campaign);

  const installs = parseFloat(r.installs) || 0;
  const cost = parseFloat(r.cost) || 0;

  const roasRev = RD.map((d) => (parseFloat(r[`roas_ad_d${d}`]) || 0) * cost);
  const ltvRev = RD.map((d) => (parseFloat(r[`lifetime_value_ad_d${d}`]) || 0) * installs);
  const ret = RT.map((d) => (parseFloat(r[`retention_rate_d${d}`]) || 0) * installs);

  rows.push({ ai, os, ci, campIdx, wKey, installs, cost, roasRev, ltvRev, ret });
}

const weeks = [...weekSet.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
const weekKeyToIdx = new Map(weeks.map((w, i) => [`${w.start}|${w.end}`, i]));
const weeksOut = weeks.map((w) => ({ s: w.start, e: w.end, m: w.start.slice(0, 7) }));

const merged = new Map();
for (const r of rows) {
  const wi = weekKeyToIdx.get(r.wKey);
  const key = [r.ai, r.os, r.ci, r.campIdx, wi].join(":");
  if (!merged.has(key)) {
    merged.set(key, {
      ai: r.ai, os: r.os, ci: r.ci, campIdx: r.campIdx, wi,
      installs: 0, cost: 0,
      roasRev: [0, 0, 0, 0, 0, 0, 0],
      ltvRev: [0, 0, 0, 0, 0, 0, 0],
      ret: [0, 0, 0, 0, 0, 0],
    });
  }
  const m = merged.get(key);
  m.installs += r.installs;
  m.cost += r.cost;
  for (let i = 0; i < 7; i++) { m.roasRev[i] += r.roasRev[i]; m.ltvRev[i] += r.ltvRev[i]; }
  for (let i = 0; i < 6; i++) m.ret[i] += r.ret[i];
}

const compactRows = [...merged.values()].map((m) => [
  m.ai, m.os, m.ci, m.campIdx, m.wi,
  round(m.installs, 0), round(m.cost, 2),
  ...m.roasRev.map((v) => round(v, 2)),
  ...m.ltvRev.map((v) => round(v, 2)),
  ...m.ret.map((v) => round(v, 2)),
]);

/* ---------------- daily actuals rows (non-cohorted) ---------------- */
const daySet = new Set();
const dailyPre = [];
let dailySkipped = 0;

for (const r of rawDaily) {
  const ai = appIdx[r.app];
  const ci = chIdx[r.channel];
  if (ai === undefined || ci === undefined) { dailySkipped++; continue; }
  const os = r.os_name === "ios" ? 1 : 0;
  const day = r.day;
  daySet.add(day);
  const campIdx = getCampaignIdx(r.campaign);
  const installs = parseFloat(r.installs) || 0;
  const cost = parseFloat(r.cost) || 0;
  const adRevenue = parseFloat(r.ad_revenue) || 0;
  dailyPre.push({ ai, os, ci, campIdx, day, installs, cost, adRevenue });
}

// also union in any days that only appear in the day-cohort pull (see build_dataset.mjs for why).
for (const r of rawDailyCohort) if (r.day) daySet.add(r.day);

const daysOut = [...daySet].sort();
const dayToIdx = new Map(daysOut.map((d, i) => [d, i]));

const dailyMerged = new Map();
for (const r of dailyPre) {
  const di = dayToIdx.get(r.day);
  const key = [r.ai, r.os, r.ci, r.campIdx, di].join(":");
  if (!dailyMerged.has(key)) {
    dailyMerged.set(key, { ai: r.ai, os: r.os, ci: r.ci, campIdx: r.campIdx, di, installs: 0, cost: 0, adRevenue: 0 });
  }
  const m = dailyMerged.get(key);
  m.installs += r.installs; m.cost += r.cost; m.adRevenue += r.adRevenue;
}

const compactDaily = [...dailyMerged.values()].map((m) => [
  m.ai, m.os, m.ci, m.campIdx, m.di,
  round(m.installs, 0), round(m.cost, 2), round(m.adRevenue, 2),
]);

/* ---------------- daily cohort rows (same metrics as weekly, dimensioned by day) ---------------- */
const dayCohortPre = [];
let dayCohortSkipped = 0;

for (const r of rawDailyCohort) {
  const ai = appIdx[r.app];
  const ci = chIdx[r.channel];
  if (ai === undefined || ci === undefined) { dayCohortSkipped++; continue; }

  const os = r.os_name === "ios" ? 1 : 0;
  const di = dayToIdx.get(r.day);
  const campIdx = getCampaignIdx(r.campaign);

  const installs = parseFloat(r.installs) || 0;
  const cost = parseFloat(r.cost) || 0;

  const roasRev = RD.map((d) => (parseFloat(r[`roas_ad_d${d}`]) || 0) * cost);
  const ltvRev = RD.map((d) => (parseFloat(r[`lifetime_value_ad_d${d}`]) || 0) * installs);
  const ret = RT.map((d) => (parseFloat(r[`retention_rate_d${d}`]) || 0) * installs);

  dayCohortPre.push({ ai, os, ci, campIdx, di, installs, cost, roasRev, ltvRev, ret });
}

const dayCohortMerged = new Map();
for (const r of dayCohortPre) {
  const key = [r.ai, r.os, r.ci, r.campIdx, r.di].join(":");
  if (!dayCohortMerged.has(key)) {
    dayCohortMerged.set(key, {
      ai: r.ai, os: r.os, ci: r.ci, campIdx: r.campIdx, di: r.di,
      installs: 0, cost: 0,
      roasRev: [0, 0, 0, 0, 0, 0, 0],
      ltvRev: [0, 0, 0, 0, 0, 0, 0],
      ret: [0, 0, 0, 0, 0, 0],
    });
  }
  const m = dayCohortMerged.get(key);
  m.installs += r.installs;
  m.cost += r.cost;
  for (let i = 0; i < 7; i++) { m.roasRev[i] += r.roasRev[i]; m.ltvRev[i] += r.ltvRev[i]; }
  for (let i = 0; i < 6; i++) m.ret[i] += r.ret[i];
}

const compactDayCohort = [...dayCohortMerged.values()].map((m) => [
  m.ai, m.os, m.ci, m.campIdx, m.di,
  round(m.installs, 0), round(m.cost, 2),
  ...m.roasRev.map((v) => round(v, 2)),
  ...m.ltvRev.map((v) => round(v, 2)),
  ...m.ret.map((v) => round(v, 2)),
]);

/* ---------------- assemble ---------------- */
const dataset = {
  apps: APPS,
  channels: CHANNELS,
  campaigns: campaignList,
  weeks: weeksOut,
  days: daysOut,
  rdDays: RD,
  rtDays: RT,
  rows: compactRows,
  dailyRows: compactDaily,
  dayCohortRows: compactDayCohort,
  meta: {
    dateRange: [pullRange.data.start, pullRange.data.end],
    refreshedAt: new Date().toISOString(),
    generatedNote: "cost source=mixed; ad revenue sources=AppLovin Max + S2S Ad Revenue (literal Datascape source labels)",
  },
};

return dataset;
