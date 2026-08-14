import { computePullRange } from "./pullrange.mjs";

export const TOKEN = process.env.ADJUST_API_TOKEN;
if (!TOKEN) throw new Error("ADJUST_API_TOKEN environment variable is not set");
export const BASE = "https://automate.adjust.com/reports-service/report";

// Rolling pull range, recomputed fresh on every run (see pullrange.mjs for the exact rule):
// end = D-1 (yesterday); start = the 1st of the month 3 months back from end, snapped to the
// Monday of its week. Start only advances once per month; end advances by one day every run.
export const PULL_RANGE = computePullRange(new Date());
export const DATE_PERIOD = `${PULL_RANGE.start}:${PULL_RANGE.end}`;
export const REFRESHED_AT = new Date().toISOString();

// verified against the user's own Datascape report config — literal display-label strings,
// NOT the generic "applovin_max_sdk"/"applovin" slugs (those pulled in ~2x extra revenue)
export const AD_REVENUE_SOURCES = "AppLovin Max,S2S Ad Revenue";

export const APPS = [
  { name: "Nova Solitaire", token: "itox02810lxc" },
  { name: "Nut Sort", token: "i3kop62h4em8" },
  { name: "Seek & Find", token: "krlu4yhkvsw0" },
  { name: "Zen Solitaire", token: "acui6z6ud0jk" },
];

export const RAW_NETWORKS = [
  "App Samurai", "CashCow", "Edge226", "Influence Mobile", "KashKick", "KickCash",
  "Mistplay", "Play2pay", "Play2Pay", "PlaybackRewards", "Playback Rewards", "Playio",
  "Pogo", "Prodege", "Tapjoy", "Tapjoy (Ad Spend)", "tapjoy_daily_rewards",
  "TaurusX", "Tyrads", "tyrads_new", "Benjamin", "Exmox",
];

export const CHANNEL_MAP = {
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

export async function fetchJSON(params, retries = 3) {
  const url = `${BASE}?${params.toString()}`;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Token token=${TOKEN}` } });
      if (!res.ok) throw new Error(`status ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e) {
      console.error(`attempt ${i + 1} failed:`, e.message);
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
