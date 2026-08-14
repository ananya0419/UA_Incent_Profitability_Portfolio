# Resource + REST queries

## 1. Resource: "Adjust Reports"

Create a new **REST API** resource.

- **Base URL:** `https://automate.adjust.com/reports-service/report`
- **Config Variables** (Resource → Config Variables tab): add one, type **Secret**:
  - name: `adjustToken`
  - value: `zkGMX84qXdfVyQu65pqm`
- **Headers:**
  - `Authorization` = `Token token={{ config.adjustToken }}`

Using a Secret config variable keeps the token encrypted at rest and out of anything client-side, instead of pasting it directly into a header value where anyone who can view the resource sees it in plaintext.

## 2. REST Query: `fetchWeeklyRawByApp`

A GET query on the Adjust Reports resource. Leave the path blank (the resource's base URL *is* the full endpoint). Query params:

| Key | Value |
|---|---|
| `ad_spend_mode` | `mixed` |
| `app_token__in` | `{{ appToken }}` |
| `date_period` | `{{ dateStart }}:{{ dateEnd }}` |
| `dimensions` | `week,os_name,network,campaign` |
| `metrics` | `installs,cost,ad_revenue,roas_ad_d0,roas_ad_d1,roas_ad_d3,roas_ad_d7,roas_ad_d14,roas_ad_d21,roas_ad_d30,retention_rate_d1,retention_rate_d3,retention_rate_d7,retention_rate_d14,retention_rate_d21,retention_rate_d30,lifetime_value_ad_d0,lifetime_value_ad_d1,lifetime_value_ad_d3,lifetime_value_ad_d7,lifetime_value_ad_d14,lifetime_value_ad_d21,lifetime_value_ad_d30` |
| `ad_revenue_sources` | `AppLovin Max,S2S Ad Revenue` |
| `network__in` | `App Samurai,CashCow,Edge226,Influence Mobile,KashKick,KickCash,Mistplay,Play2pay,Play2Pay,PlaybackRewards,Playback Rewards,Playio,Pogo,Prodege,Tapjoy,Tapjoy (Ad Spend),tapjoy_daily_rewards,TaurusX,Tyrads,tyrads_new,Benjamin,Exmox` |

`{{ appToken }}`, `{{ dateStart }}`, `{{ dateEnd }}` come from `additionalScope` when the orchestrator query (`fetchAllWeekly.js`) triggers this — they'll show an "undefined variable" error in the query editor until first triggered with a scope, which is expected (Retool's own docs note this).

Set this query to **not run automatically on page load** — only `fetchAllWeekly` should trigger it.

## 3. REST Query: `fetchDailyRawByApp`

Same resource, same shape, but mirrors `fetch_daily.mjs` (unscoped, non-cohorted daily actuals — this is what the Stop Simulator's trailing-day averages are built from, deliberately not cohorted):

| Key | Value |
|---|---|
| `ad_spend_mode` | `mixed` |
| `app_token__in` | `{{ appToken }}` |
| `date_period` | `{{ dateStart }}:{{ dateEnd }}` |
| `dimensions` | `day,os_name,network,campaign` |
| `metrics` | `installs,cost,ad_revenue` |
| `ad_revenue_sources` | `AppLovin Max,S2S Ad Revenue` |
| `network__in` | (same list as above) |

Also set to not run automatically on page load.
