// Retool JS Query named: fetchAllDaily
// Depends on: pullRange, fetchDailyRawByApp (REST query). Ported from fetch_daily.mjs.
// Same Promise.all pattern as fetchAllWeekly.js, for the same reason.

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
  fetchDailyRawByApp
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
