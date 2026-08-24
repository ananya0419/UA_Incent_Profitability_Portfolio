// Retool JS Query named: fetchAllDailyCohort
// Depends on: pullRange, fetchDailyCohortRawByApp (REST query). Ported from fetch_daily_cohort.mjs.
// Same cohort metrics as fetchAllWeekly.js, but day-dimensioned — powers the day-level
// drill-down inside an expanded week row. Same Promise.all pattern as the other orchestrators,
// for the same additionalScope-reuse-bug reason documented in fetchAllWeekly.js.

const APPS = [
  { name: "Nova Solitaire", token: "itox02810lxc" },
  { name: "Nut Sort", token: "i3kop62h4em8" },
  { name: "Seek & Find", token: "krlu4yhkvsw0" },
  { name: "Zen Solitaire", token: "acui6z6ud0jk" },
];

const CHANNEL_MAP = {
  "App Samurai": "App Samurai",
  "CashCow": "Cashcow",
  "Edge226": "Edge226",
  "Influence Mobile": "Influence Mobile",
  "KashKick": "KashKick",
  "KickCash": "Kickcash",
  "Mistplay": "Mistplay",
  "Play2pay": "Play2Pay",
  "Play2Pay": "Play2Pay",
  "PlaybackRewards": "Playback Rewards",
  "Playback Rewards": "Playback Rewards",
  "Playio": "Playio",
  "Pogo": "Pogo",
  "Prodege": "Prodege",
  "Tapjoy": "Tapjoy",
  "Tapjoy (Ad Spend)": "Tapjoy",
  "tapjoy_daily_rewards": "Tapjoy",
  "TaurusX": "TaurusX",
  "Tyrads": "Tyrads",
  "tyrads_new": "Tyrads New",
  "Benjamin": "benjamin",
  "Exmox": "exmox",
};

const range = pullRange.data;

const promises = APPS.map((app) =>
  fetchDailyCohortRawByApp
    .trigger({
      additionalScope: { appToken: app.token, dateStart: range.start, dateEnd: range.end },
    })
    .then((result) => ({ app, rows: (result && result.rows) || [] }))
);

const results = await Promise.all(promises);

const allRows = [];
for (const { app, rows } of results) {
  for (const r of rows) {
    const channel = CHANNEL_MAP[r.network];
    if (!channel) continue;
    allRows.push({ app: app.name, ...r, channel });
  }
}

return allRows;
