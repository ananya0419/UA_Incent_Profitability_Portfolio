// Retool JS Query named: fetchAllWeekly
// Depends on: pullRange (run first), fetchWeeklyRawByApp (REST query, triggered here per app).
// Ported from fetch_all.mjs. Uses Promise.all rather than a sequential for-loop + await,
// since Retool has a documented bug where additionalScope gets reused from the first call
// across sequential awaited trigger() calls in a loop — Promise.all avoids that entirely
// because each trigger() call captures its own scope object at call time.

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
  fetchWeeklyRawByApp
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
