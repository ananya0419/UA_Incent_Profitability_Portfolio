(function(){
"use strict";
// DATA arrives either as a static blob baked in at build time (window.__DASHBOARD_DATA__,
// used by the Claude Artifact build) or pushed in live later via window.__dashboardSetData()
// (used when this file is embedded in a Retool custom component driven by a live query).
// applyDataset()/bootUI() below are split so both paths work without duplicating the file.
// Fixed cohort-day schema — always this exact shape by construction (see build_dataset.mjs),
// not derived per-dataset, so these are safe to use at module-eval time before any data arrives.
var RD = [0, 1, 3, 7, 14, 21, 30];
var RT = [1, 3, 7, 14, 21, 30];

var DATA, WEEKS, DAYS, CHANNELS, APPS, CAMPAIGNS, ROWS, DAILY, DAYCOHORT,
  DATA_END, DATA_START, DATA_END_STR, DATA_START_STR;

function applyDataset(dataset){
  DATA = dataset;
  WEEKS = DATA.weeks;    // [{s,e,m}]
  DAYS = DATA.days;      // ["YYYY-MM-DD", ...] sorted
  CHANNELS = DATA.channels;
  APPS = DATA.apps;
  CAMPAIGNS = DATA.campaigns;
  ROWS = DATA.rows;
  DAILY = DATA.dailyRows;
  DAYCOHORT = DATA.dayCohortRows || [];  // same field layout as ROWS, but field 4 indexes DAYS not WEEKS
  DATA_END = parseDate(DATA.meta.dateRange[1]);
  DATA_START = parseDate(DATA.meta.dateRange[0]);
  DATA_END_STR = DATA.meta.dateRange[1];
  DATA_START_STR = DATA.meta.dateRange[0];
}
if (window.__DASHBOARD_DATA__) applyDataset(window.__DASHBOARD_DATA__);

// weekly-cohort row field indices
var F_AI=0,F_OS=1,F_CI=2,F_CAMP=3,F_WI=4,F_INS=5,F_COST=6,F_RR=7,F_LR=14,F_RT=21;
// daily-actuals row field indices
var D_AI=0,D_OS=1,D_CI=2,D_CAMP=3,D_DI=4,D_INS=5,D_COST=6,D_REV=7;

function parseDate(s){ var p=s.split("-"); return new Date(Date.UTC(+p[0],+p[1]-1,+p[2])); }
function addDays(d,n){ return new Date(d.getTime()+n*86400000); }
function isoDate(d){ return d.toISOString().slice(0,10); }
function addDaysStr(s,n){ return isoDate(addDays(parseDate(s),n)); }
function dayDiff(a,b){ return Math.round((parseDate(b)-parseDate(a))/86400000); }
function clampStr(s,lo,hi){ return s<lo?lo:(s>hi?hi:s); }
function fmtDateLabel(s){
  var d=parseDate(s);
  return d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});
}
function fmtMonthLabel(m){
  var d=parseDate(m+"-01");
  return d.toLocaleDateString("en-US",{month:"short",year:"numeric",timeZone:"UTC"});
}
function fmtInt(n){ return Math.round(n).toLocaleString("en-US"); }
function fmtMoney0(n){ if(n==null) return "—"; return "$"+Math.round(n).toLocaleString("en-US"); }
function fmtMoney2(n){ if(n==null) return "—"; return "$"+n.toFixed(2); }
function fmtPct1(n){ if(n==null) return "—"; return (n*100).toFixed(1)+"%"; }
function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];}); }

/* ---------------- state ---------------- */
// When DATA isn't available yet (Retool: data arrives async after the script first runs),
// these get filled in for real inside applyDataset()'s caller (see __dashboardSetData below).
var state = {
  rangeStart: DATA ? DATA.meta.dateRange[0] : null,
  rangeEnd: DATA ? DATA.meta.dateRange[1] : null,
  granularity: "week", // 'week' | 'month'
  minInstalls: 1,
  trailingDays: 3,
  stopThresh: 0.70,
  scaleThresh: 1.00,
  activeTab: "summary", // 'summary' | app index as string
  osFilter: {}, // per app tab: 'all'|'android'|'ios'
  summaryOS: "all",
  expanded: new Set(),
  cols: { roas:true, ret:true, ltv:true, mult:true },
  selected: new Set(), // "appIdx:ci:campIdx"
  sort: { key:null, dir:"desc" }, // sortkey e.g. "installs","spend","status","verdict","roas_7","ret_14","ltv_30"
  multiplierOverrides: new Map(), // "appIdx:ci:campIdx:granularity:periodId:hopIdx" -> number
  pacingTargets: new Map(), // "<scopeKey>:<metricKey>" -> number, manually entered
};

/* ---------------- filtering / aggregation (weekly cohort) ---------------- */
var filteredWeekIdx = null; // Set of week indices currently in range

function recomputeWeekFilter(){
  var s = state.rangeStart, e = state.rangeEnd;
  var set = new Set();
  for(var i=0;i<WEEKS.length;i++){
    var w = WEEKS[i];
    if(w.e >= s && w.s <= e) set.add(i);
  }
  filteredWeekIdx = set;
}

function osMatches(rowOs, filter){
  if(filter==="all") return true;
  if(filter==="android") return rowOs===0;
  return rowOs===1;
}

// generic leaf-row filter (weekly cohort table)
function leafRows(appIdx, osFilter, ci, campIdx){
  var out=[];
  for(var i=0;i<ROWS.length;i++){
    var r=ROWS[i];
    if(appIdx!=null && r[F_AI]!==appIdx) continue;
    if(ci!=null && r[F_CI]!==ci) continue;
    if(campIdx!=null && r[F_CAMP]!==campIdx) continue;
    if(!filteredWeekIdx.has(r[F_WI])) continue;
    if(r[F_INS] < state.minInstalls) continue;
    if(!osMatches(r[F_OS], osFilter)) continue;
    out.push(r);
  }
  return out;
}

function emptyAgg(){
  return { installs:0, cost:0, roasRev:new Array(RD.length).fill(0), ltvRev:new Array(RD.length).fill(0),
           ret:new Array(RT.length).fill(0), weekSet:new Set(), maxWeekEnd:null, n:0 };
}
function foldInto(agg, r){
  agg.installs += r[F_INS]; agg.cost += r[F_COST]; agg.n++;
  for(var i=0;i<RD.length;i++){ agg.roasRev[i]+=r[F_RR+i]; agg.ltvRev[i]+=r[F_LR+i]; }
  for(var i=0;i<RT.length;i++){ agg.ret[i]+=r[F_RT+i]; }
  agg.weekSet.add(r[F_WI]);
  var we = WEEKS[r[F_WI]].e;
  if(agg.maxWeekEnd==null || we > agg.maxWeekEnd) agg.maxWeekEnd = we;
  return agg;
}
function aggregateRows(rows){
  var agg = emptyAgg();
  for(var i=0;i<rows.length;i++) foldInto(agg, rows[i]);
  return agg;
}

// cohort ROAS / LTV / retention — informational trend columns only (verdict no longer derives from these)
function deriveCohortMetrics(agg){
  var d = { installs:agg.installs, cost:agg.cost, roas:[], ltv:[], ret:[], roasMature:[], retMature:[] };
  // clamp to the actual data cutoff: the last (current) week's nominal calendar-week end can
  // fall AFTER the data cutoff even though it only has 1-2 real days in it — using the nominal
  // end there would mark even D0 "immature", which is wrong (D0 is same-day and always available).
  var maxEndDate = agg.maxWeekEnd ? parseDate(clampStr(agg.maxWeekEnd, DATA_START_STR, DATA_END_STR)) : null;
  for(var i=0;i<RD.length;i++){
    d.roas.push(agg.cost>0 ? agg.roasRev[i]/agg.cost : null);
    d.ltv.push(agg.installs>0 ? agg.ltvRev[i]/agg.installs : null);
    d.roasMature.push(maxEndDate!=null && addDays(maxEndDate,RD[i]) <= DATA_END);
  }
  for(var i=0;i<RT.length;i++){
    d.ret.push(agg.installs>0 ? agg.ret[i]/agg.installs : null);
    d.retMature.push(maxEndDate!=null && addDays(maxEndDate,RT[i]) <= DATA_END);
  }
  var bestIdx=-1;
  for(var i=RD.length-1;i>=0;i--){ if(d.roasMature[i] && d.roas[i]!=null){ bestIdx=i; break; } }
  d.bestIdx = bestIdx;
  d.bestDay = bestIdx>=0 ? RD[bestIdx] : null;
  d.bestRoas = bestIdx>=0 ? d.roas[bestIdx] : null;
  return d;
}

function classifyRatio(ratio){
  if(ratio>=state.scaleThresh) return "scale";
  if(ratio>=state.stopThresh) return "watch";
  return "stop";
}

/* ---------------- daily actuals (non-cohorted) + run-rate verdict ---------------- */
function dailyLeafRows(appIdx, osFilter, ci, campIdx, dStart, dEnd){
  var out=[];
  for(var i=0;i<DAILY.length;i++){
    var r=DAILY[i];
    if(appIdx!=null && r[D_AI]!==appIdx) continue;
    if(ci!=null && r[D_CI]!==ci) continue;
    if(campIdx!=null && r[D_CAMP]!==campIdx) continue;
    if(!osMatches(r[D_OS], osFilter)) continue;
    var day = DAYS[r[D_DI]];
    if(day < dStart || day > dEnd) continue;
    out.push(r);
  }
  return out;
}

/* ---------------- daily cohort (day-level drill-down within an expanded week) ---------------- */
// Same field layout as ROWS (F_AI/F_OS/F_CI/F_CAMP/F_INS/F_COST/F_RR/F_LR/F_RT all line up
// identically — see build_dataset.mjs), but field index F_WI indexes DAYS instead of WEEKS.
// No minInstalls filter here (unlike leafRows): once a week has been drilled into, every one of
// its calendar days should show, including low/zero-volume ones, for a complete picture.
function dayCohortLeafRows(appIdx, osFilter, ci, campIdx, dStart, dEnd){
  var out=[];
  for(var i=0;i<DAYCOHORT.length;i++){
    var r=DAYCOHORT[i];
    if(appIdx!=null && r[F_AI]!==appIdx) continue;
    if(ci!=null && r[F_CI]!==ci) continue;
    if(campIdx!=null && r[F_CAMP]!==campIdx) continue;
    if(!osMatches(r[F_OS], osFilter)) continue;
    var day = DAYS[r[F_WI]];
    if(day < dStart || day > dEnd) continue;
    out.push(r);
  }
  return out;
}
// Mirrors aggregateRows/foldInto exactly, except the maturity-anchor date is the day itself
// rather than a week's end — deriveCohortMetrics only ever reads agg.maxWeekEnd as a generic
// "anchor date string", so it's reused unchanged for day-level aggregates.
function aggregateDayCohortRows(rows){
  var agg = emptyAgg();
  for(var i=0;i<rows.length;i++){
    var r = rows[i];
    agg.installs += r[F_INS]; agg.cost += r[F_COST]; agg.n++;
    for(var k=0;k<RD.length;k++){ agg.roasRev[k]+=r[F_RR+k]; agg.ltvRev[k]+=r[F_LR+k]; }
    for(var k=0;k<RT.length;k++){ agg.ret[k]+=r[F_RT+k]; }
    var day = DAYS[r[F_WI]];
    if(agg.maxWeekEnd==null || day > agg.maxWeekEnd) agg.maxWeekEnd = day;
  }
  return agg;
}

// Status badge: Live only if spend > 0 on D-1 (the row window's own last calendar day,
// clipped to available data + the selected range) — a single day's spend decides it.
var STATUS_WINDOW = 1;
function computeStatus3d(appIdx, osFilter, ci, campIdx, winStart, winEnd){
  var clipStart = clampStr(winStart, state.rangeStart, state.rangeEnd);
  var clipEnd = clampStr(winEnd, state.rangeStart, state.rangeEnd);
  var effEnd = clipEnd > DATA_END_STR ? DATA_END_STR : clipEnd;
  if(effEnd < clipStart || effEnd < DATA_START_STR){
    return { status:"nodata", days:[] };
  }
  var days = [];
  for(var i=STATUS_WINDOW-1;i>=0;i--){
    var d = addDaysStr(effEnd, -i);
    if(d < clipStart || d < DATA_START_STR) continue;
    days.push(d);
  }
  if(days.length===0) return { status:"nodata", days:[] };
  var detail = days.map(function(d){
    var rows = dailyLeafRows(appIdx, osFilter, ci, campIdx, d, d);
    var cost = 0; for(var i=0;i<rows.length;i++) cost += rows[i][D_COST];
    return { date:d, cost:cost };
  });
  var live = detail.length===STATUS_WINDOW && detail.every(function(x){ return x.cost>0; });
  return { status: live?"live":"paused", days: detail };
}
function statusBadgeHTML(s){
  if(s.status==="nodata") return '<span class="badge pending" title="No spend data in this window">NO DATA</span>';
  var label = s.status==="live" ? "LIVE" : "PAUSED";
  var cls = s.status==="live" ? "live" : "paused";
  var title = "Last "+s.days.length+" day(s): "+s.days.map(function(x){ return fmtDateLabel(x.date)+" "+fmtMoney2(x.cost); }).join(" · ")
    + (s.status==="paused" ? " — $0 spend" : " — spend > $0");
  return '<span class="badge '+cls+'" title="'+esc(title)+'">'+label+'</span>';
}

// "the stop list" verdict: average daily spend & average daily (non-cohorted) ad revenue
// over the trailing N days of the given window, clipped to available data + the selected range.
function computeRunRate(appIdx, osFilter, ci, campIdx, winStart, winEnd){
  var clipStart = clampStr(winStart, state.rangeStart, state.rangeEnd);
  var clipEnd = clampStr(winEnd, state.rangeStart, state.rangeEnd);
  var effEnd = clipEnd > DATA_END_STR ? DATA_END_STR : clipEnd;
  if(effEnd < clipStart || effEnd < DATA_START_STR){
    return { avgSpend:null, avgRev:null, ratio:null, verdict:"nodata", daysInWindow:0, windowStart:clipStart, windowEnd:clipEnd };
  }
  var effStart = addDaysStr(effEnd, -(state.trailingDays-1));
  if(effStart < clipStart) effStart = clipStart;
  if(effStart < DATA_START_STR) effStart = DATA_START_STR;
  var daysInWindow = dayDiff(effStart, effEnd) + 1;
  var rows = dailyLeafRows(appIdx, osFilter, ci, campIdx, effStart, effEnd);
  var sumCost=0, sumRev=0;
  for(var i=0;i<rows.length;i++){ sumCost += rows[i][D_COST]; sumRev += rows[i][D_REV]; }
  var avgSpend = sumCost/daysInWindow, avgRev = sumRev/daysInWindow;
  var verdict, ratio;
  if(sumCost>0){ ratio = sumRev/sumCost; verdict = classifyRatio(ratio); }
  else if(sumRev>0){ ratio = null; verdict = "scale"; }
  else { ratio = null; verdict = "nodata"; }
  return { avgSpend:avgSpend, avgRev:avgRev, ratio:ratio, verdict:verdict, daysInWindow:daysInWindow, windowStart:effStart, windowEnd:effEnd };
}

// verdict badge: D30 ad RoAS — observed when the cohort has fully matured, otherwise
// the same D30 figure treated as an in-progress estimate (still ticking up toward its final value).
var D30_IDX = RD.indexOf(30);
function d30Verdict(d){
  var v = d.roas[D30_IDX];
  if(d.installs<=0 || d.cost<=0 || v==null) return { verdict:"nodata", value:null, mature:false, predicted:false };
  return { verdict:classifyRatio(v), value:v, mature:d.roasMature[D30_IDX], predicted:false };
}
function badgeHTML(v){
  var map = { scale:["SCALE","scale"], watch:["WATCH","watch"], stop:["STOP","stop"], nodata:["NO DATA","pending"] };
  var m = map[v.verdict] || map.nodata;
  var suffix = v.value!=null ? " · D30" : "";
  var title = v.value!=null
    ? (v.predicted
        ? ("Predicted D30 ad RoAS: "+fmtPct1(v.value)+" — chained from the last observed day using the RoAS-multiplier row below (edit those numbers to change this prediction)")
        : ("D30 ad RoAS: "+fmtPct1(v.value)+(v.mature?" (observed — cohort fully matured)":" (estimated — cohort still maturing, will keep moving)")))
    : "No spend / no cohort data in this range";
  return '<span class="badge '+m[1]+'" title="'+esc(title)+'">'+m[0]+suffix+'</span>';
}
function pausedBadgeHTML(status){
  return '<span class="badge paused" title="Paused — no spend on the last '+(status.days.length||1)+' day(s) checked, so the RoAS verdict is on hold">PAUSED</span>';
}
// Once D30 itself is mature, behaves exactly like d30Verdict. Until then, use the predicted
// D30 (chained from the last observed day via that row's RoAS-multiplier cells) instead of
// trusting Adjust's raw immature D30 figure at face value.
function predictedD30Verdict(d, predictedD30){
  if(d.roasMature[D30_IDX]) return d30Verdict(d);
  if(predictedD30==null || d.installs<=0 || d.cost<=0) return { verdict:"nodata", value:null, mature:false, predicted:false };
  return { verdict:classifyRatio(predictedD30), value:predictedD30, mature:false, predicted:true };
}
// if the row is currently Paused (per the Status badge), the RoAS verdict is moot — show
// Paused there too instead of a Stop/Watch/Scale call on a campaign that isn't spending.
function effectiveVerdictKey(d, status, predictedD30){
  return status.status==="paused" ? "paused" : predictedD30Verdict(d, predictedD30).verdict;
}
function verdictBadgeHTML(d, status, predictedD30){
  if(status.status==="paused") return pausedBadgeHTML(status);
  return badgeHTML(predictedD30Verdict(d, predictedD30));
}

function tintClass(verdict){ return verdict==="scale"?"tint-scale":verdict==="watch"?"tint-watch":verdict==="stop"?"tint-stop":""; }
function cellVerdict(v){ if(v==null) return null; if(v>=state.scaleThresh) return "scale"; if(v>=state.stopThresh) return "watch"; return "stop"; }

function basicAndRoasCellsHTML(d){
  var out = "";
  out += '<td class="col-basic num">'+fmtInt(d.installs)+'</td>';
  out += '<td class="col-basic num">'+(d.installs>0 ? fmtMoney2(d.cost/d.installs) : '<span class="dash">—</span>')+'</td>';
  out += '<td class="col-basic num">'+fmtMoney0(d.cost)+'</td>';
  for(var i=0;i<RD.length;i++){
    var v=d.roas[i], mature=d.roasMature[i];
    var cls="col-roas num"+(i===0?" grpstart":"");
    if(v==null){ out += '<td class="'+cls+'"><span class="dash">—</span></td>'; continue; }
    var vc = mature ? cellVerdict(v) : null;
    var txt = (mature?"":"~") + fmtPct1(v);
    out += '<td class="'+cls+'"><span class="cell-tint '+(vc?tintClass(vc):'')+' '+(mature?'':'immature')+'">'+txt+'</span></td>';
  }
  return out;
}
// Separate column, immediately after the actual D30 cell: shows only what's being projected
// (chained via the RoAS-multiplier row), never mixed into the actual/observed D30 figure above.
function predictedCellHTML(d, predictedD30){
  var cls = "col-predict num grpstart";
  if(d.roasMature[D30_IDX]){
    var actual = d.roas[D30_IDX];
    var avc = cellVerdict(actual);
    return '<td class="'+cls+'"><span class="cell-tint '+(avc?tintClass(avc):'')+'" title="D30 already observed — matches the actual RoAS · D30 column">'+fmtPct1(actual)+'</span></td>';
  }
  if(predictedD30==null) return '<td class="'+cls+'"><span class="dash" title="Not enough mature history yet to chain a prediction">—</span></td>';
  var vc = cellVerdict(predictedD30);
  return '<td class="'+cls+'"><span class="cell-tint predict-cell '+tintClass(vc)+'" title="Predicted D30 ad RoAS, chained from the last observed day via the RoAS Multiplier row">≈ '+fmtPct1(predictedD30)+'</span></td>';
}
function retAndLtvCellsHTML(d){
  var out = "";
  for(var i=0;i<RT.length;i++){
    var v=d.ret[i], mature=d.retMature[i];
    var cls="col-ret num"+(i===0?" grpstart":"");
    if(v==null){ out += '<td class="'+cls+'"><span class="dash">—</span></td>'; continue; }
    var txt=(mature?"":"~")+fmtPct1(v);
    out += '<td class="'+cls+'"><span class="'+(mature?'':'immature')+'">'+txt+'</span></td>';
  }
  for(var i=0;i<RD.length;i++){
    var v=d.ltv[i], mature=d.roasMature[i];
    var cls="col-ltv num"+(i===0?" grpstart":"");
    if(v==null){ out += '<td class="'+cls+'"><span class="dash">—</span></td>'; continue; }
    var txt=(mature?"":"~")+fmtMoney2(v);
    out += '<td class="'+cls+'"><span class="'+(mature?'':'immature')+'">'+txt+'</span></td>';
  }
  return out;
}
function metricCellsHTML(d, predictedD30, hops){
  return basicAndRoasCellsHTML(d) + predictedCellHTML(d, predictedD30) + multiplierCellsHTML(hops||null) + retAndLtvCellsHTML(d);
}

/* ---------------- RoAS multipliers + D30 prediction ---------------- */
// HOPS[k] = [fromIdx, toIdx] into RD, i.e. D0->D1, D1->D3, D3->D7, D7->D14, D14->D21, D21->D30
var HOPS = [];
for(var _h=0; _h<RD.length-1; _h++) HOPS.push([_h, _h+1]);
var HOP_LABELS = HOPS.map(function(h){ return "D"+RD[h[0]]+"→D"+RD[h[1]]; });

// Chains forward from the last observed (mature) RoAS day to D30 using one multiplier value
// per remaining hop. Returns null if D30 is unreachable (no mature day at all, or a gap in hops).
function chainPredictedD30(d, hops){
  if(d.bestIdx < 0 || d.installs<=0 || d.cost<=0) return null;
  if(d.bestIdx >= RD.length-1) return d.roas[RD.length-1]; // D30 already mature, nothing to chain
  var val = d.bestRoas;
  for(var k=d.bestIdx; k<HOPS.length; k++){
    var hv = hops[k].value;
    if(hv==null) return null;
    val = val * hv;
  }
  return val;
}

// Walks a chronological list of {d:...} period objects once, resolving each hop for each
// period to: a user override, else its own observed multiplier if that hop is mature for this
// period, else the average of the same hop's observed multiplier from the last 3 EARLIER
// periods that had it mature. Also computes the chained D30 prediction from the last mature day.
function computePeriodMultipliers(periods, seriesKey){
  var history = HOPS.map(function(){ return []; }); // per-hop rolling list of observed multipliers, chronological
  periods.forEach(function(p){
    var d = p.d;
    var hops = HOPS.map(function(hop, k){
      var fromIdx = hop[0], toIdx = hop[1];
      var mature = !!d.roasMature[toIdx];
      var actual = (d.roas[fromIdx]!=null && d.roas[fromIdx]>0 && d.roas[toIdx]!=null) ? d.roas[toIdx]/d.roas[fromIdx] : null;
      var overrideKey = seriesKey+":"+p.periodId+":"+k;
      var overridden = state.multiplierOverrides.has(overrideKey);
      var value, source;
      if(overridden){ value = state.multiplierOverrides.get(overrideKey); source = "override"; }
      else if(mature && actual!=null){ value = actual; source = "observed"; }
      else {
        var hist = history[k].slice(-3);
        value = hist.length ? (hist.reduce(function(a,b){return a+b;},0)/hist.length) : null;
        source = hist.length ? "estimated" : "nodata";
      }
      if(mature && actual!=null) history[k].push(actual); // feed future fallback from TRUE observations only
      return { key:overrideKey, value:value, mature:mature, source:source, label:HOP_LABELS[k] };
    });
    p.hops = hops;
    p.predictedD30 = chainPredictedD30(d, hops);
  });
  return periods;
}

// Verdict basis for a channel/campaign rollup: the last 2 MATURED weeks only (within the
// currently selected range), never a prediction and never the full-range blend — a stop/keep
// call should reflect solid, recent, real performance. Falls back to just 1 matured week if
// that's all there is, or "no data" if none. Only the verdict badge uses this; every other
// displayed metric (Installs, Spend, RoAS trend, etc.) still reflects the full selected range.
function computeVerdictBasis(appIdx, osFilter, ci, campIdx){
  var rows = leafRows(appIdx, osFilter, ci, campIdx);
  var byWeek = new Map();
  rows.forEach(function(r){ var wi=r[F_WI]; if(!byWeek.has(wi)) byWeek.set(wi, []); byWeek.get(wi).push(r); });
  var maturedWis = [...byWeek.keys()].filter(function(wi){
    return deriveCohortMetrics(aggregateRows(byWeek.get(wi))).roasMature[D30_IDX];
  }).sort(function(a,b){ return b-a; }); // most recent matured week first
  var lastTwo = maturedWis.slice(0,2);
  var basisRows = [];
  lastTwo.forEach(function(wi){ basisRows = basisRows.concat(byWeek.get(wi)); });
  return deriveCohortMetrics(aggregateRows(basisRows));
}

// Channel/campaign rollup rows span many weeks at once, so there's no single "this period's own
// multiplier" — instead each hop is the average of that hop's ACTUAL (mature-only) multiplier
// across every week in the currently selected range that has it. Editable, same override map.
function computeRollupMultipliers(appIdx, osFilter, ci, campIdx){
  var rows = leafRows(appIdx, osFilter, ci, campIdx);
  var byWeek = new Map();
  rows.forEach(function(r){ var wi=r[F_WI]; if(!byWeek.has(wi)) byWeek.set(wi, []); byWeek.get(wi).push(r); });
  var sums = HOPS.map(function(){ return { sum:0, n:0 }; });
  byWeek.forEach(function(weekRows){
    var wd = deriveCohortMetrics(aggregateRows(weekRows));
    HOPS.forEach(function(hop, k){
      var fromIdx=hop[0], toIdx=hop[1];
      if(wd.roasMature[toIdx] && wd.roas[fromIdx]!=null && wd.roas[fromIdx]>0 && wd.roas[toIdx]!=null){
        sums[k].sum += wd.roas[toIdx]/wd.roas[fromIdx];
        sums[k].n++;
      }
    });
  });
  var keyBase = appIdx+":"+ci+":"+(campIdx==null?"_":campIdx)+":rollup";
  return HOPS.map(function(hop, k){
    var s = sums[k];
    var overrideKey = keyBase+":"+k;
    var overridden = state.multiplierOverrides.has(overrideKey);
    var avg = s.n ? s.sum/s.n : null;
    var value = overridden ? state.multiplierOverrides.get(overrideKey) : avg;
    var source = overridden ? "override" : (s.n ? "observed-avg" : "nodata");
    return { key:overrideKey, value:value, mature: s.n>0, source:source, label:HOP_LABELS[k], n:s.n };
  });
}

function multiplierCellsHTML(hops){
  var out = "";
  for(var k=0;k<HOPS.length;k++){
    var tdCls = "col-mult"+(k===0?" grpstart":"");
    if(!hops){ out += '<td class="'+tdCls+'"><span class="dash">—</span></td>'; continue; }
    var h = hops[k];
    var cls = h.mature ? "mult-mature" : "mult-immature";
    var val = h.value==null ? "" : Math.round(h.value*1000)/1000;
    var title = h.source==="override" ? "Your override"
      : h.source==="observed" ? "Observed from this period's own mature cohort"
      : h.source==="observed-avg" ? "Average of "+h.n+" week(s) in this range where "+h.label+" was mature (actual, not a fallback estimate)"
      : h.source==="estimated" ? "Estimated: average of the last up-to-3 periods where "+h.label+" was mature"
      : "No mature history yet for "+h.label;
    out += '<td class="'+tdCls+'"><input type="number" step="0.01" class="mult-input '+cls+'" data-multkey="'+esc(h.key)+'" value="'+(val===""?"":val)+'" placeholder="—" title="'+esc(title)+'"/></td>';
  }
  return out;
}

// per-row reset: every override key for a rollup or period is "<prefix>:<hopIdx>" — clearing
// by prefix lets you undo just one row's edits instead of every override on the whole page.
function hasOverridesWithPrefix(prefix){
  for(var k of state.multiplierOverrides.keys()){ if(k.indexOf(prefix+":")===0) return true; }
  return false;
}
function resetRowBtnHTML(prefix, label){
  if(!hasOverridesWithPrefix(prefix)) return "";
  return '<button class="row-reset" data-resetprefix="'+esc(prefix)+'" title="Clear your RoAS × overrides for '+esc(label)+'">↺</button>';
}

/* ---------------- distinct helpers ---------------- */
function distinctChannelsForApp(appIdx, osFilter){
  var present = new Set();
  for(var i=0;i<ROWS.length;i++){
    var r=ROWS[i];
    if(r[F_AI]!==appIdx) continue;
    if(!filteredWeekIdx.has(r[F_WI])) continue;
    if(r[F_INS] < state.minInstalls) continue;
    if(!osMatches(r[F_OS], osFilter)) continue;
    present.add(r[F_CI]);
  }
  var list=[];
  for(var ci=0; ci<CHANNELS.length; ci++) if(present.has(ci)) list.push(ci);
  return list;
}
function distinctCampaignsFor(appIdx, osFilter, ci){
  var set = new Set();
  var rows = leafRows(appIdx, osFilter, ci, null);
  for(var i=0;i<rows.length;i++) set.add(rows[i][F_CAMP]);
  return [...set];
}
function distinctCampaignsForChannelAnyFilter(appIdx, ci){
  // used for "select all campaigns under a channel" — ignores os/week/install filters
  var set = new Set();
  for(var i=0;i<ROWS.length;i++){ var r=ROWS[i]; if(r[F_AI]===appIdx && r[F_CI]===ci) set.add(r[F_CAMP]); }
  return [...set];
}

/* ---------------- rendering: app tab table ---------------- */
function colGroupClasses(){
  var c=[]; if(!state.cols.roas) c.push("hide-roas"); if(!state.cols.ret) c.push("hide-ret"); if(!state.cols.ltv) c.push("hide-ltv"); if(!state.cols.mult) c.push("hide-mult hide-predict");
  return c.join(" ");
}

function sortTh(label, key, extraCls){
  var active = state.sort.key===key;
  var arrow = active ? (state.sort.dir==="asc" ? " ▲" : " ▼") : "";
  return '<th class="sortable'+(extraCls?" "+extraCls:"")+(active?" sorted":"")+'" data-sortkey="'+key+'">'+label+arrow+'</th>';
}

function tableHeadHTML(){
  var h = "";
  h += '<thead>';
  h += '<tr class="grp">';
  h += '<th class="namecol" colspan="1"></th>';
  h += '<th colspan="2"></th>';
  h += '<th colspan="3">Volume</th>';
  h += '<th colspan="'+RD.length+'" class="col-roas grpstart">RoAS · Ad (cohort, actual)</th>';
  h += '<th colspan="1" class="col-predict grpstart">Predicted</th>';
  h += '<th colspan="'+HOPS.length+'" class="col-mult grpstart">RoAS Multiplier (editable)</th>';
  h += '<th colspan="'+RT.length+'" class="col-ret grpstart">Retention</th>';
  h += '<th colspan="'+RD.length+'" class="col-ltv grpstart">LTV · Ad ($, cohort)</th>';
  h += '<th colspan="1">Trend</th>';
  h += '</tr>';
  h += '<tr class="day">';
  h += '<th class="namecol">Channel / Campaign / Period</th>';
  h += sortTh("Status","status");
  h += sortTh("Verdict (D30 RoAS)","verdict");
  h += sortTh("Installs","installs","col-basic");
  h += sortTh("CPI","cpi","col-basic");
  h += sortTh("Spend","spend","col-basic");
  for(var i=0;i<RD.length;i++) h += sortTh("D"+RD[i], "roas_"+RD[i], "col-roas"+(i===0?" grpstart":""));
  h += sortTh("D30 (pred.)", "predicted", "col-predict grpstart");
  for(var i=0;i<HOPS.length;i++) h += '<th class="col-mult'+(i===0?" grpstart":"")+'">'+HOP_LABELS[i]+'</th>';
  for(var i=0;i<RT.length;i++) h += sortTh("D"+RT[i], "ret_"+RT[i], "col-ret"+(i===0?" grpstart":""));
  for(var i=0;i<RD.length;i++) h += sortTh("D"+RD[i], "ltv_"+RD[i], "col-ltv"+(i===0?" grpstart":""));
  h += '<th>WoW</th>';
  h += '</tr></thead>';
  return h;
}

/* ---------------- sorting ---------------- */
function sortValue(key, d, status, predictedD30){
  if(key==="status") return status.status==="live"?2:(status.status==="paused"?1:0);
  if(key==="verdict"){ var order={scale:4,watch:3,stop:2,paused:1,nodata:0}; return order[effectiveVerdictKey(d,status,predictedD30)]; }
  if(key==="predicted") return predictedD30;
  if(key==="installs") return d.installs;
  if(key==="cpi") return d.installs>0 ? d.cost/d.installs : null;
  if(key==="spend") return d.cost;
  if(key.indexOf("roas_")===0){ var idx=RD.indexOf(+key.slice(5)); return idx>=0?d.roas[idx]:null; }
  if(key.indexOf("ret_")===0){ var idx=RT.indexOf(+key.slice(4)); return idx>=0?d.ret[idx]:null; }
  if(key.indexOf("ltv_")===0){ var idx=RD.indexOf(+key.slice(4)); return idx>=0?d.ltv[idx]:null; }
  return null;
}
// arr: [{d, status, predictedD30, verdictD, ...}] (verdictD only present on channel/campaign
// objs — see computeVerdictBasis). Live-status rows always come first as a standing rule,
// regardless of which column (if any) is actively sorted; the active sort (or the cost-desc
// default when none is active) only decides order WITHIN each of the Live / non-Live groups.
// Sorting specifically by "verdict" uses each row's verdictD (last-2-matured-weeks basis) so the
// sort order matches what the verdict badge actually shows; every other column uses the regular
// full-range d. Mutates in place; nulls always sink to the bottom regardless of direction.
function sortRowsPinLive(arr){
  var sort = state.sort;
  arr.sort(function(a,b){
    var la = a.status.status==="live" ? 0 : 1;
    var lb = b.status.status==="live" ? 0 : 1;
    if(la !== lb) return la-lb;
    if(!sort || !sort.key) return 0; // preserve the cost-desc default order already applied
    var isVerdict = sort.key==="verdict";
    var da = isVerdict ? a.verdictD : a.d, db = isVerdict ? b.verdictD : b.d;
    var pa = isVerdict ? null : a.predictedD30, pb = isVerdict ? null : b.predictedD30;
    var va = sortValue(sort.key, da, a.status, pa), vb = sortValue(sort.key, db, b.status, pb);
    if(va==null && vb==null) return 0;
    if(va==null) return 1;
    if(vb==null) return -1;
    return sort.dir==="asc" ? (va-vb) : (vb-va);
  });
}

function trendHTML(curr, prev){
  if(!prev || curr.roas[3]==null || prev.roas[3]==null || prev.roas[3]===0) return '<span class="dash">—</span>';
  var mult = curr.roas[3]/prev.roas[3];
  var cls = mult>1.03?"up":(mult<0.97?"down":"flat");
  var arrow = mult>1.03?"▲":(mult<0.97?"▼":"■");
  return '<span class="trend '+cls+'">'+arrow+' '+mult.toFixed(2)+'x</span>';
}

function checkboxState(appIdx, ci, campIdx){
  return state.selected.has(appIdx+":"+ci+":"+campIdx);
}
function channelCheckState(appIdx, ci){
  var camps = distinctCampaignsForChannelAnyFilter(appIdx, ci);
  var sel = camps.filter(function(cp){ return checkboxState(appIdx,ci,cp); });
  if(sel.length===0) return "none";
  if(sel.length===camps.length) return "all";
  return "some";
}

function renderAppTable(appIdx, osFilter){
  var channels = distinctChannelsForApp(appIdx, osFilter);
  if(channels.length===0) return '<div class="empty-note">No channel activity in this date range / OS / install-threshold combination.</div>';

  var channelObjs = channels.map(function(ci){
    var d = deriveCohortMetrics(aggregateRows(leafRows(appIdx, osFilter, ci, null)));
    var status = computeStatus3d(appIdx, osFilter, ci, null, state.rangeStart, state.rangeEnd);
    var hops = computeRollupMultipliers(appIdx, osFilter, ci, null);
    return { ci:ci, d:d, status:status, hops:hops, predictedD30: chainPredictedD30(d, hops), verdictD: computeVerdictBasis(appIdx, osFilter, ci, null) };
  });
  channelObjs.sort(function(a,b){ return b.d.cost - a.d.cost; }); // default order
  sortRowsPinLive(channelObjs); // Live channels always first; column sort (if any) applies within each group

  var rows = [];
  channelObjs.forEach(function(co){
    var ci=co.ci, d=co.d, chStatus=co.status;
    var chKey = appIdx+":ch:"+ci;
    var open = state.expanded.has(chKey);
    var chkState = channelCheckState(appIdx, ci);
    var chResetPrefix = appIdx+":"+ci+":_:rollup";
    rows.push('<tr class="lvl-channel" data-key="'+chKey+'">'+
      '<td class="namecell"><div class="namewrap indent-0">'+
        '<button class="disclose'+(open?" open":"")+'" data-toggle="'+chKey+'">▶</button>'+
        '<input type="checkbox" class="stopchk" data-chsel="'+appIdx+':'+ci+'" '+(chkState==="all"?"checked":"")+' '+(chkState==="some"?'data-indeterminate="1"':'')+'/>'+
        '<span class="namelabel">'+esc(CHANNELS[ci])+'</span>'+
        resetRowBtnHTML(chResetPrefix, CHANNELS[ci])+
      '</div></td>'+
      '<td>'+statusBadgeHTML(chStatus)+'</td>'+
      '<td>'+verdictBadgeHTML(co.verdictD, chStatus, null)+'</td>'+
      metricCellsHTML(d, co.predictedD30, co.hops)+
      '<td class="dash">—</td>'+
    '</tr>');
    if(open){
      var camps = distinctCampaignsFor(appIdx, osFilter, ci);
      var campObjs = camps.map(function(campIdx){
        var cd = deriveCohortMetrics(aggregateRows(leafRows(appIdx, osFilter, ci, campIdx)));
        var cStatus = computeStatus3d(appIdx, osFilter, ci, campIdx, state.rangeStart, state.rangeEnd);
        var chops = computeRollupMultipliers(appIdx, osFilter, ci, campIdx);
        return { campIdx:campIdx, d:cd, status:cStatus, hops:chops, predictedD30: chainPredictedD30(cd, chops), verdictD: computeVerdictBasis(appIdx, osFilter, ci, campIdx) };
      });
      campObjs.sort(function(a,b){ return b.d.cost - a.d.cost; });
      sortRowsPinLive(campObjs); // Live campaigns always first; column sort (if any) applies within each group
      campObjs.forEach(function(co2){
        var campIdx=co2.campIdx, cd=co2.d, cStatus=co2.status;
        var campKey = appIdx+":camp:"+ci+":"+campIdx;
        var copen = state.expanded.has(campKey);
        var campResetPrefix = appIdx+":"+ci+":"+campIdx+":rollup";
        rows.push('<tr class="lvl-campaign" data-key="'+campKey+'">'+
          '<td class="namecell"><div class="namewrap indent-1">'+
            '<button class="disclose'+(copen?" open":"")+'" data-toggle="'+campKey+'">▶</button>'+
            '<input type="checkbox" class="stopchk" data-campsel="'+appIdx+':'+ci+':'+campIdx+'" '+(checkboxState(appIdx,ci,campIdx)?"checked":"")+'/>'+
            '<span class="namelabel">'+esc(CAMPAIGNS[campIdx])+'</span>'+
            resetRowBtnHTML(campResetPrefix, CAMPAIGNS[campIdx])+
          '</div></td>'+
          '<td>'+statusBadgeHTML(cStatus)+'</td>'+
          '<td>'+verdictBadgeHTML(co2.verdictD, cStatus, null)+'</td>'+
          metricCellsHTML(cd, co2.predictedD30, co2.hops)+
          '<td class="dash">—</td>'+
        '</tr>');
        if(copen){
          var periods = buildPeriods(appIdx, osFilter, ci, campIdx);
          var periodObjs = periods.map(function(p){
            return { p:p, d:p.d, status: computeStatus3d(appIdx, osFilter, ci, campIdx, p.winStart, p.winEnd), predictedD30: p.predictedD30 };
          });
          // periods always stay chronological — column sorting never reorders weeks/months (unlike
          // channel/campaign rows), since a shuffled timeline defeats the point of a trend view.
          var periodSeriesKey = appIdx+":"+ci+":"+campIdx+":"+state.granularity;
          var isWeekGran = state.granularity==="week";
          var prev=null;
          periodObjs.forEach(function(po){
            var p=po.p, pStatus=po.status;
            var periodResetPrefix = periodSeriesKey+":"+p.periodId;
            var dayToggleKey = "day:"+appIdx+":"+ci+":"+campIdx+":"+p.periodId;
            var dayOpen = isWeekGran && state.expanded.has(dayToggleKey);
            rows.push('<tr class="lvl-period">'+
              '<td class="namecell"><div class="namewrap indent-2">'+
                (isWeekGran
                  ? '<button class="disclose'+(dayOpen?" open":"")+'" data-toggle="'+dayToggleKey+'">▶</button>'
                  : '<button class="disclose leaf">▶</button>')+
                '<span class="namelabel">'+esc(p.label)+'</span>'+
                resetRowBtnHTML(periodResetPrefix, p.label)+
              '</div></td>'+
              '<td>'+statusBadgeHTML(pStatus)+'</td>'+
              '<td>'+verdictBadgeHTML(p.d, pStatus, p.predictedD30)+'</td>'+
              metricCellsHTML(p.d, p.predictedD30, p.hops)+
              '<td>'+trendHTML(p.d, prev)+'</td>'+
            '</tr>');
            prev = p.d;
            if(dayOpen){
              var dayPeriods = buildDayPeriods(appIdx, osFilter, ci, campIdx, p.winStart, p.winEnd);
              var dayObjs = dayPeriods.map(function(dp){
                return { p:dp, d:dp.d, status: computeStatus3d(appIdx, osFilter, ci, campIdx, dp.winStart, dp.winEnd), predictedD30: dp.predictedD30 };
              });
              // same rule as periods: days always stay chronological, never sorted by a column.
              var dprev = null;
              dayObjs.forEach(function(dpo){
                var dp=dpo.p, dStatus=dpo.status;
                var dayResetPrefix = appIdx+":"+ci+":"+campIdx+":day:"+dp.periodId;
                rows.push('<tr class="lvl-day">'+
                  '<td class="namecell"><div class="namewrap indent-3">'+
                    '<button class="disclose leaf">▶</button>'+
                    '<span class="namelabel">'+esc(dp.label)+'</span>'+
                    resetRowBtnHTML(dayResetPrefix, dp.label)+
                  '</div></td>'+
                  '<td>'+statusBadgeHTML(dStatus)+'</td>'+
                  '<td>'+verdictBadgeHTML(dp.d, dStatus, dp.predictedD30)+'</td>'+
                  metricCellsHTML(dp.d, dp.predictedD30, dp.hops)+
                  '<td>'+trendHTML(dp.d, dprev)+'</td>'+
                '</tr>');
                dprev = dp.d;
              });
            }
          });
        }
      });
    }
  });
  return '<table class="dt '+colGroupClasses()+'">'+tableHeadHTML()+'<tbody>'+rows.join("")+'</tbody></table>';
}

function buildPeriods(appIdx, osFilter, ci, campIdx){
  var rows = leafRows(appIdx, osFilter, ci, campIdx);
  var seriesKey = appIdx+":"+ci+":"+campIdx+":"+state.granularity;
  var periods;
  if(state.granularity==="week"){
    var byWeek = new Map();
    rows.forEach(function(r){ var wi=r[F_WI]; if(!byWeek.has(wi)) byWeek.set(wi,[]); byWeek.get(wi).push(r); });
    var wis = [...byWeek.keys()].sort(function(a,b){return a-b;});
    periods = wis.map(function(wi){
      var w=WEEKS[wi];
      return {
        periodId: "w"+wi,
        label: fmtDateLabel(w.s)+" – "+fmtDateLabel(w.e),
        d: deriveCohortMetrics(aggregateRows(byWeek.get(wi))),
        winStart: w.s, winEnd: w.e,
      };
    });
  } else {
    var byMonth = new Map();
    rows.forEach(function(r){ var m=WEEKS[r[F_WI]].m; if(!byMonth.has(m)) byMonth.set(m,[]); byMonth.get(m).push(r); });
    var ms = [...byMonth.keys()].sort();
    periods = ms.map(function(m){
      var monthStart = m+"-01";
      var nextMonth = addDays(parseDate(monthStart), 32);
      var nextMonthFirst = parseDate(isoDate(nextMonth).slice(0,8)+"01");
      var lastDay = isoDate(addDays(nextMonthFirst, -1));
      return {
        periodId: "m"+m,
        label: fmtMonthLabel(m),
        d: deriveCohortMetrics(aggregateRows(byMonth.get(m))),
        winStart: monthStart, winEnd: lastDay,
      };
    });
  }
  return computePeriodMultipliers(periods, seriesKey);
}

// One period per calendar day within [weekStart, weekEnd] (clipped to available data) — every
// day is shown, including $0-spend ones, for a complete picture once a week is drilled into.
// Multiplier chaining/history is naturally scoped to just this week's ~7 days, since each call
// only ever sees this one week's periods.
function buildDayPeriods(appIdx, osFilter, ci, campIdx, weekStart, weekEnd){
  var clipStart = weekStart < DATA_START_STR ? DATA_START_STR : weekStart;
  var clipEnd = weekEnd > DATA_END_STR ? DATA_END_STR : weekEnd;
  var seriesKey = appIdx+":"+ci+":"+campIdx+":day";
  var periods = [];
  if(clipEnd >= clipStart){
    for(var d=clipStart; d<=clipEnd; d=addDaysStr(d,1)){
      var dayRows = dayCohortLeafRows(appIdx, osFilter, ci, campIdx, d, d);
      periods.push({
        periodId: "d"+d,
        label: fmtDateLabel(d),
        d: deriveCohortMetrics(aggregateDayCohortRows(dayRows)),
        winStart: d, winEnd: d,
      });
    }
  }
  return computePeriodMultipliers(periods, seriesKey);
}

/* ---------------- KPI tiles ---------------- */
function renderKpis(appIdx, osFilter){
  var rows = leafRows(appIdx, osFilter, null, null);
  var d = deriveCohortMetrics(aggregateRows(rows));
  var channels = distinctChannelsForApp(appIdx, osFilter);
  var counts = {stop:0,watch:0,scale:0,nodata:0,paused:0};
  channels.forEach(function(ci){
    var st = computeStatus3d(appIdx, osFilter, ci, null, state.rangeStart, state.rangeEnd);
    var verdictD = computeVerdictBasis(appIdx, osFilter, ci, null);
    counts[effectiveVerdictKey(verdictD, st, null)]++;
  });
  var html = '<div class="kpis">';
  html += kpiTile("Spend (range)", fmtMoney0(d.cost));
  html += kpiTile("Installs (range)", fmtInt(d.installs));
  html += kpiTile("Blended RoAS (cohort)", d.bestDay!=null? fmtPct1(d.bestRoas)+' <span style="font-size:.65rem;color:var(--ink-soft)">(D'+d.bestDay+')</span>' : "—");
  html += kpiTile("Channels to Stop", counts.stop, "stop");
  html += kpiTile("Channels to Watch", counts.watch, "watch");
  html += kpiTile("Channels to Scale", counts.scale, "scale");
  html += kpiTile("Channels Paused", counts.paused, "paused-tone");
  html += '</div>';
  return html;
}
function kpiTile(label, val, tone){
  return '<div class="kpi"><div class="lbl">'+label+'</div><div class="val'+(tone?" "+tone:"")+'">'+val+'</div></div>';
}

/* ---------------- summary tab ---------------- */
function renderSummary(){
  var osFilter = state.summaryOS;
  var totalAgg = emptyAgg();
  APPS.forEach(function(_,ai){ leafRows(ai, osFilter, null, null).forEach(function(r){ foldInto(totalAgg, r); }); });
  var td = deriveCohortMetrics(totalAgg);

  var allCounts={stop:0,watch:0,scale:0,paused:0};
  var cardsHtml = APPS.map(function(app, ai){
    var channels = distinctChannelsForApp(ai, osFilter);
    var buckets = {stop:[],watch:[],scale:[],nodata:[],paused:[]};
    channels.forEach(function(ci){
      var st = computeStatus3d(ai, osFilter, ci, null, state.rangeStart, state.rangeEnd);
      var verdictD = computeVerdictBasis(ai, osFilter, ci, null);
      var v = predictedD30Verdict(verdictD, null);
      var key = effectiveVerdictKey(verdictD, st, null);
      buckets[key].push({name:CHANNELS[ci], value:v.value, mature:v.mature, predicted:v.predicted, paused:key==="paused"});
      if(allCounts[key]!=null) allCounts[key]++;
    });
    ["stop","watch","scale","nodata","paused"].forEach(function(k){ buckets[k].sort(function(a,b){ return (a.value==null?-1:a.value)-(b.value==null?-1:b.value); }); });
    var appAgg = deriveCohortMetrics(aggregateRows(leafRows(ai, osFilter, null, null)));
    function listHTML(arr){
      if(arr.length===0) return '<div class="none">none</div>';
      return '<ul class="chlist">'+arr.map(function(c){
        var rr = c.paused ? "paused" : (c.value!=null?fmtPct1(c.value)+(c.mature?'':(c.predicted?' (pred.)':' (est)')):'—');
        return '<li><span class="nm">'+esc(c.name)+'</span><span class="rr">'+rr+'</span></li>';
      }).join("")+'</ul>';
    }
    return '<div class="game-card">'+
      '<div class="game-card-head"><h3>'+esc(app)+'</h3><div class="stat">'+fmtMoney0(appAgg.cost)+' spend · '+fmtInt(appAgg.installs)+' installs · '+(appAgg.bestDay!=null?fmtPct1(appAgg.bestRoas)+' D'+appAgg.bestDay+' cohort RoAS':'—')+'</div></div>'+
      '<div class="game-card-body">'+
        '<div class="verdict-col stop"><h4>Stop ('+buckets.stop.length+')</h4>'+listHTML(buckets.stop)+'</div>'+
        '<div class="verdict-col watch"><h4>Watch ('+buckets.watch.length+')</h4>'+listHTML(buckets.watch)+'</div>'+
        '<div class="verdict-col scale"><h4>Scale ('+buckets.scale.length+')</h4>'+listHTML(buckets.scale)+'</div>'+
        '<div class="verdict-col paused"><h4>Paused ('+buckets.paused.length+')</h4>'+listHTML(buckets.paused)+'</div>'+
      '</div>'+
    '</div>';
  }).join("");

  var html = '<div class="kpis">'+
      kpiTile("Portfolio Spend", fmtMoney0(td.cost))+
      kpiTile("Portfolio Installs", fmtInt(td.installs))+
      kpiTile("Blended RoAS (cohort)", td.bestDay!=null?fmtPct1(td.bestRoas)+' (D'+td.bestDay+')':"—")+
      kpiTile("Channels to Stop", allCounts.stop, "stop")+
      kpiTile("Channels to Watch", allCounts.watch, "watch")+
      kpiTile("Channels to Scale", allCounts.scale, "scale")+
      kpiTile("Channels Paused", allCounts.paused, "paused-tone")+
    '</div>'+
    '<div class="os-pick seg" data-summary-os>'+
      ["all","android","ios"].map(function(o){ return '<button data-os="'+o+'" class="'+(osFilter===o?"active":"")+'">'+(o==="all"?"All OS":o==="android"?"Android":"iOS")+'</button>'; }).join("")+
    '</div>'+
    '<div class="game-grid">'+cardsHtml+'</div>';
  return html;
}

/* ---------------- stop simulator ---------------- */
function computeSimTotals(){
  var keys = [...state.selected];
  var items = keys.map(function(k){
    var parts = k.split(":"); var ai=+parts[0], ci=+parts[1], cp=+parts[2];
    var rr = computeRunRate(ai, "all", ci, cp, state.rangeStart, state.rangeEnd);
    return { key:k, appIdx:ai, ci:ci, campIdx:cp, avgSpend: rr.avgSpend||0, avgRev: rr.avgRev||0 };
  });
  items.sort(function(a,b){ return b.avgSpend - a.avgSpend; });
  var sumSpend=0, sumRev=0;
  items.forEach(function(it){ sumSpend += it.avgSpend; sumRev += it.avgRev; });
  var ratio = sumSpend>0 ? sumRev/sumSpend : null;
  var days = Math.max(1, dayDiff(state.rangeStart, state.rangeEnd)+1);
  return { count: keys.length, avgSpend: sumSpend, avgRev: sumRev, ratio: ratio, days: days, items: items };
}
// which OS(es) a campaign has ever run on, regardless of the selected date range / OS filter —
// most campaigns are OS-specific by naming convention, but this checks the real data either way.
function campaignOsLabel(appIdx, ci, campIdx){
  var hasAndroid=false, hasIos=false;
  for(var i=0;i<ROWS.length;i++){
    var r=ROWS[i];
    if(r[F_AI]!==appIdx || r[F_CI]!==ci || r[F_CAMP]!==campIdx) continue;
    if(r[F_OS]===0) hasAndroid=true; else hasIos=true;
    if(hasAndroid && hasIos) break;
  }
  if(hasAndroid && hasIos) return "Android/iOS";
  if(hasAndroid) return "Android";
  if(hasIos) return "iOS";
  return null;
}
function simRowHTML(it){
  var os = campaignOsLabel(it.appIdx, it.ci, it.campIdx);
  return '<div class="simrow">'+
    '<button class="simrow-remove" data-unselect="'+esc(it.key)+'" title="Unselect this campaign">×</button>'+
    '<span class="simrow-name">'+esc(APPS[it.appIdx])+(os?' <span class="simrow-os">('+esc(os)+')</span>':'')+' · '+esc(CAMPAIGNS[it.campIdx])+' <span class="simrow-chan">('+esc(CHANNELS[it.ci])+')</span></span>'+
    '<span class="simrow-spend">-'+fmtMoney0(it.avgSpend)+'/day</span>'+
    '<span class="simrow-rev">-'+fmtMoney0(it.avgRev)+'/day</span>'+
  '</div>';
}
// CSV (not true .xlsx — the platform's download capability only allows a fixed extension
// list and .xlsx isn't on it; .csv is, and opens directly in Excel with the same columns).
function csvEscape(v){
  var s = String(v);
  if(/[",\r\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function buildSimCsv(items){
  var lines = [["Game Name","OS","Channel","Campaign","Total Daily Spend Drop","Total Daily Revenue Drop"].join(",")];
  items.forEach(function(it){
    var os = campaignOsLabel(it.appIdx, it.ci, it.campIdx) || "";
    lines.push([
      APPS[it.appIdx],
      os,
      CHANNELS[it.ci],
      CAMPAIGNS[it.campIdx],
      (Math.round(it.avgSpend*100)/100).toFixed(2),
      (Math.round(it.avgRev*100)/100).toFixed(2),
    ].map(csvEscape).join(","));
  });
  return lines.join("\r\n");
}
function setExportStatus(msg){
  var el = document.getElementById("simexport-status");
  if(el) el.textContent = msg;
}
function downloadViaBlob(filename, csv){
  var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  setExportStatus("Saved "+filename);
}
async function exportSimCsv(){
  var t = computeSimTotals();
  if(t.items.length===0){ setExportStatus("Nothing selected yet — check a campaign or channel first."); return; }
  var csv = buildSimCsv(t.items);
  var filename = "portfolio-kill-switch-stop-list-"+state.rangeEnd+".csv";
  // claude.use("downloads") is the Claude Artifacts platform API and only exists there; anywhere
  // else (e.g. this file embedded in a Retool custom component) fall back to a plain Blob download.
  if(typeof claude === "undefined" || !claude.use){ downloadViaBlob(filename, csv); return; }
  setExportStatus("Preparing download…");
  var downloads;
  try{ downloads = await claude.use("downloads"); } catch(e){ downloads = null; }
  if(!downloads){ downloadViaBlob(filename, csv); return; }
  try{
    await downloads.save({ filename: filename, data: csv });
    setExportStatus("Saved "+filename);
  } catch(e){
    var code = e && e.code;
    var msg = code==="declined" ? "Download declined."
      : code==="rate_limited" ? "Try again in a moment."
      : code==="extension_not_enabled" ? "CSV downloads aren't enabled in this view."
      : code==="too_large" ? "Selection is too large to export."
      : "Couldn't start the download.";
    setExportStatus(msg);
  }
}
function renderSim(){
  var t = computeSimTotals();
  var bar = document.getElementById("simbar");
  var toggle = document.getElementById("simtoggle");
  toggle.querySelector(".count").textContent = t.count;
  toggle.hidden = t.count===0;
  if(t.count===0){ bar.classList.remove("open"); }
  document.getElementById("sim-count").textContent = t.count+" item"+(t.count===1?"":"s")+" selected to stop";
  document.getElementById("sim-dailyspend").textContent = fmtMoney0(t.avgSpend)+"/day";
  document.getElementById("sim-spend").textContent = "≈ "+fmtMoney0(t.avgSpend*t.days)+" over selected range";
  document.getElementById("sim-dailyrev0").textContent = fmtMoney0(t.avgRev)+"/day";
  document.getElementById("sim-rev0").textContent = "≈ "+fmtMoney0(t.avgRev*t.days)+" over selected range";
  document.getElementById("sim-breakdown").innerHTML = t.items.length
    ? t.items.map(simRowHTML).join("")
    : '<div class="simlist-empty">Check a campaign or channel row above to start building a stop list.</div>';
  document.getElementById("sim-roas").textContent = t.ratio!=null? fmtPct1(t.ratio) : (t.avgRev>0?"∞":"—");
}

/* ---------------- top-level render ---------------- */
function render(){
  recomputeWeekFilter();
  var root = document.getElementById("app");

  // render() fully replaces #app's markup (including the scrollable table), which would
  // otherwise reset every scroll position to 0 on every keystroke-driven edit (multiplier
  // inputs, sort clicks, checkboxes, ...) — capture and restore so the view doesn't jump.
  var oldScrollEl = root.querySelector(".table-scroll");
  var savedTop = oldScrollEl ? oldScrollEl.scrollTop : 0;
  var savedLeft = oldScrollEl ? oldScrollEl.scrollLeft : 0;
  var savedWinX = window.scrollX, savedWinY = window.scrollY;

  var tabsHtml = '<div class="tabbar" role="tablist">'+
    tabBtn("summary","Summary")+
    APPS.map(function(a,i){ return tabBtn(String(i), a); }).join("")+
    tabBtn("pacing","Pacing")+
  '</div>';
  document.getElementById("tabbar-slot").innerHTML = tabsHtml;

  var panels = "";
  panels += '<div class="tabpanel'+(state.activeTab==="summary"?" active":"")+'" data-panel="summary">'+renderSummary()+summaryFootnote()+'</div>';
  APPS.forEach(function(app, ai){
    var osFilter = state.osFilter[ai] || "all";
    var active = state.activeTab===String(ai);
    var body = active ? (renderKpis(ai, osFilter) + appPanelControls(ai, osFilter) + '<div class="panel"><div class="table-scroll">'+renderAppTable(ai, osFilter)+'</div></div>' + footnote()) : "";
    panels += '<div class="tabpanel'+(active?" active":"")+'" data-panel="'+ai+'">'+body+'</div>';
  });
  var pacingActive = state.activeTab==="pacing";
  panels += '<div class="tabpanel'+(pacingActive?" active":"")+'" data-panel="pacing">'+(pacingActive?renderPacing():"")+'</div>';
  root.innerHTML = panels;
  root.querySelectorAll('[data-indeterminate="1"]').forEach(function(el){ el.indeterminate = true; });

  var newScrollEl = root.querySelector(".table-scroll");
  if(newScrollEl){ newScrollEl.scrollTop = savedTop; newScrollEl.scrollLeft = savedLeft; }
  window.scrollTo(savedWinX, savedWinY);

  renderSim();
}

function tabBtn(key,label){
  return '<button class="tabbtn'+(state.activeTab===key?" active":"")+'" data-tab="'+key+'">'+esc(label)+'</button>';
}

function appPanelControls(ai, osFilter){
  return '<div class="panel" style="margin-bottom:14px;">'+
    '<div class="panel-head">'+
      '<h2>Channel &amp; Campaign Detail</h2>'+
      '<div class="subctrls">'+
        '<div class="seg" data-osfilter="'+ai+'">'+
          ["all","android","ios"].map(function(o){ return '<button data-os="'+o+'" class="'+(osFilter===o?"active":"")+'">'+(o==="all"?"All OS":o==="android"?"Android":"iOS")+'</button>'; }).join("")+
        '</div>'+
        '<div class="chipset">'+
          colChip("roas","RoAS")+colChip("mult","RoAS ×")+colChip("ret","Retention")+colChip("ltv","LTV")+
        '</div>'+
        '<button class="btn-ghost" id="resetMultBtn" title="Clear every RoAS-multiplier edit you\'ve made, everywhere — for just one row, use the ↺ that appears next to its name instead">Reset ALL RoAS × overrides</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}
function colChip(key,label){
  var on = state.cols[key];
  return '<label class="chip-toggle'+(on?" on":"")+'"><input type="checkbox" data-colgroup="'+key+'" '+(on?"checked":"")+'/>'+label+'</label>';
}
function footnote(){
  return '<div class="footnote">Spend source: <code>mixed</code> (Adjust attributed + network-reported). Ad revenue source: <code>AppLovin Max + S2S Ad Revenue</code> only. The <b>Status</b> badge is Live only if spend was &gt;$0 on D-1 (the last calendar day of that row\'s window); a $0 day flags it Paused — hover it for the exact figure. The <b>Verdict</b> badge is D30 ad RoAS for that row within the selected date range — shown as "observed" once the cohort has fully matured, or as an in-progress estimate (hover the badge for the exact figure) when it hasn\'t yet — <b>unless</b> Status is Paused, in which case Verdict shows Paused too rather than a stale RoAS call on something that isn\'t currently spending. Cells prefixed <code>~</code> in the RoAS/Retention/LTV columns are similarly still maturing as of '+fmtDateLabel(DATA.meta.dateRange[1])+'. Click any column header in the frozen row to sort by it (click again to flip direction) — applies within whichever level you\'re looking at (channels, or the campaigns under an expanded channel, or the weeks/months under an expanded campaign). The <b>D30</b> column under RoAS · Ad is always the actual, raw figure Adjust reports — never touched by the multiplier edits. The separate <b>Predicted</b> column right after it shows only the projection, chained from the last observed day via the <b>RoAS Multiplier</b> cells further right — solid border where a multiplier is observed real data, dashed amber where it isn\'t: on week/month rows that\'s the average of the last up to 3 periods that did have it mature; on channel/campaign rows (which span many weeks at once) it\'s the average across every week in the selected range that had it mature. Every multiplier cell is editable; type your own number to watch the Predicted column — and the Verdict badge, if that row\'s own D30 isn\'t mature yet — update live. A small ↺ appears next to any row\'s name once you\'ve edited it — click it to clear just that row\'s overrides; "Reset ALL RoAS × overrides" up top clears every row at once. The Stop Simulator below uses a separate, more current figure — see its own note.</div>';
}
function summaryFootnote(){
  return '<div class="footnote">Verdict per channel = D30 ad RoAS (observed once the cohort has fully matured, otherwise a predicted D30 — marked "(pred.)" below — chained from the last mature day via that channel\'s own RoAS-multiplier averages; a bare "—" means not even that could be computed), rolled up across every campaign on that channel within the selected date range — unless the channel is Paused (no spend on D-1), in which case it\'s bucketed as Paused instead of Stop/Watch/Scale. Rule: RoAS <'+Math.round(state.stopThresh*100)+'% → Stop, '+Math.round(state.stopThresh*100)+'–'+Math.round(state.scaleThresh*100)+'% → Watch, ≥'+Math.round(state.scaleThresh*100)+'% → Scale. Adjust the thresholds from the “Rules” control in the top bar. The Stop Simulator (bottom bar, once you check items) instead totals the trailing '+state.trailingDays+'-day average daily spend and average daily <em>non-cohorted</em> ad revenue for whatever you\'ve selected — a live, current-run-rate view rather than a cohort estimate.</div>';
}

/* ---------------- pacing tab ---------------- */
// Pure view over the existing non-cohorted daily actuals (DAILY) — no new pull, no cohort
// concepts. "Daily spend: Total" etc. at day grain = that day's own totals; at month grain =
// the average per day that month (so the two RoAS rows below coincide at month grain — that's
// an intentional, documented simplification, not a bug). "Monthly ...: Total" = cumulative
// sum-to-date within that month, resetting at each month boundary. "EOM ... forecast" = for a
// month that's fully elapsed within the data, just the actual total (nothing left to forecast);
// for the current/partial month, a run-rate extrapolation: (cumulative-to-date / days elapsed)
// × days in month. "IAA RoAS Daily" = daily rev/spend (month grain: the two average rates
// against each other). "IAA RoAS Running" = cumulative rev/spend to date within the month.
var PACING_ROWS = [
  { key:"dailySpend", label:"Daily spend: Total", fmt:"money0", changeEligible:true },
  { key:"monthlySpend", label:"Monthly spend: Total", fmt:"money0", changeEligible:false },
  { key:"eomSpend", label:"EOM spend: forecast", fmt:"money0", changeEligible:true },
  { key:"dailyRev", label:"Daily IAA Rev", fmt:"money0", changeEligible:true },
  { key:"monthlyRev", label:"Monthly IAA Rev", fmt:"money0", changeEligible:false },
  { key:"eomRev", label:"EOM IAA Rev forecast", fmt:"money0", changeEligible:true },
  { key:"roasDaily", label:"IAA RoAS Daily", fmt:"pct1", changeEligible:false },
  { key:"roasRunning", label:"IAA RoAS Running", fmt:"pct1", changeEligible:true },
];
var PACING_FIELD_DAILY = { dailySpend:"cost", monthlySpend:"cumCost", eomSpend:"eomCost", dailyRev:"rev", monthlyRev:"cumRev", eomRev:"eomRev", roasDaily:"roasDaily", roasRunning:"roasRunning" };
var PACING_FIELD_MONTHLY = { dailySpend:"avgDailyCost", monthlySpend:"totalCost", eomSpend:"eomCost", dailyRev:"avgDailyRev", monthlyRev:"totalRev", eomRev:"eomRev", roasDaily:"roasDaily", roasRunning:"roasRunning" };

function pacingDayAgg(appIdx, osFilter, ci){
  var byDay = new Map(); // dayIdx -> {cost, rev}
  for(var i=0;i<DAILY.length;i++){
    var r = DAILY[i];
    if(appIdx!=null && r[D_AI]!==appIdx) continue;
    if(ci!=null && r[D_CI]!==ci) continue;
    if(!osMatches(r[D_OS], osFilter)) continue;
    var di = r[D_DI];
    if(!byDay.has(di)) byDay.set(di, {cost:0, rev:0});
    var e = byDay.get(di);
    e.cost += r[D_COST]; e.rev += r[D_REV];
  }
  return byDay;
}
function pacingDayList(){
  var out = [];
  for(var i=0;i<DAYS.length;i++){
    var day = DAYS[i];
    if(day < state.rangeStart || day > state.rangeEnd) continue;
    out.push({ idx:i, day:day, month: day.slice(0,7) });
  }
  return out; // DAYS is already sorted, so this stays chronological
}
function pacingDaysInMonth(m){
  return new Date(Date.UTC(+m.slice(0,4), +m.slice(5,7), 0)).getUTCDate();
}
// Per-day series for one scope (all-portfolio if appIdx/ci are both null), each day carrying its
// own totals plus running cumulative-within-month, run-rate EOM forecast, and both RoAS flavors.
function buildPacingSeries(appIdx, osFilter, ci){
  var agg = pacingDayAgg(appIdx, osFilter, ci);
  var days = pacingDayList();
  var daily = days.map(function(d){
    var e = agg.get(d.idx) || {cost:0, rev:0};
    return { day:d.day, month:d.month, cost:e.cost, rev:e.rev };
  });
  var monthState = {}; // month -> {cumCost, cumRev, count}
  daily.forEach(function(row){
    var m = row.month;
    if(!monthState[m]) monthState[m] = { cumCost:0, cumRev:0, count:0 };
    var ms = monthState[m];
    ms.cumCost += row.cost; ms.cumRev += row.rev; ms.count++;
    row.cumCost = ms.cumCost; row.cumRev = ms.cumRev;
    var daysInMonth = pacingDaysInMonth(m);
    row.eomCost = ms.count>0 ? (ms.cumCost/ms.count)*daysInMonth : null;
    row.eomRev = ms.count>0 ? (ms.cumRev/ms.count)*daysInMonth : null;
    row.roasDaily = row.cost>0 ? row.rev/row.cost : null;
    row.roasRunning = ms.cumCost>0 ? ms.cumRev/ms.cumCost : null;
  });
  return daily;
}
// Monthly rollup derived from the same daily series (never re-fetched/re-aggregated separately),
// so the two views can never drift out of sync with each other.
function buildPacingMonthly(dailySeries){
  var byMonth = new Map();
  dailySeries.forEach(function(row){
    if(!byMonth.has(row.month)) byMonth.set(row.month, []);
    byMonth.get(row.month).push(row);
  });
  var months = [...byMonth.keys()].sort();
  return months.map(function(m){
    var rows = byMonth.get(m);
    var last = rows[rows.length-1];
    var totalCost = last.cumCost, totalRev = last.cumRev;
    var isComplete = rows.length >= pacingDaysInMonth(m);
    var avgCost = totalCost/rows.length, avgRev = totalRev/rows.length;
    return {
      month: m,
      avgDailyCost: avgCost, avgDailyRev: avgRev,
      totalCost: totalCost, totalRev: totalRev,
      eomCost: isComplete ? totalCost : last.eomCost,
      eomRev: isComplete ? totalRev : last.eomRev,
      roasDaily: avgCost>0 ? avgRev/avgCost : null,
      roasRunning: totalCost>0 ? totalRev/totalCost : null,
    };
  });
}
function pacingFmt(row, val){
  if(val==null) return '<span class="dash">—</span>';
  return row.fmt==="pct1" ? fmtPct1(val) : fmtMoney0(val);
}
function pacingChangeHTML(row, monthly){
  if(!row.changeEligible || monthly.length<2) return '<span class="dash">—</span>';
  var curr = monthly[monthly.length-1][PACING_FIELD_MONTHLY[row.key]];
  var prev = monthly[monthly.length-2][PACING_FIELD_MONTHLY[row.key]];
  if(curr==null || prev==null || prev===0) return '<span class="dash">—</span>';
  var pct = (curr-prev)/prev;
  var cls = pct>0.001 ? "up" : (pct<-0.001 ? "down" : "flat");
  return '<span class="trend '+cls+'">'+(pct>=0?"+":"")+(pct*100).toFixed(1)+'%</span>';
}
function pacingTargetHTML(scopeKey, row){
  var key = scopeKey+":"+row.key;
  var val = state.pacingTargets.has(key) ? state.pacingTargets.get(key) : "";
  return '<input type="number" step="any" class="pacing-target" data-pacingtarget="'+esc(key)+'" value="'+(val===""?"":val)+'" placeholder="—">';
}
function isPacingCurrentMonth(m){ return m === DATA_END_STR.slice(0,7); }
function fmtDayHeaderLabel(s){
  var d = parseDate(s);
  return d.toLocaleDateString("en-US",{weekday:"short",timeZone:"UTC"})+" "+d.getUTCDate()+" "+d.toLocaleDateString("en-US",{month:"short",timeZone:"UTC"});
}
function renderPacingTable(scopeKey, appIdx, osFilter, ci){
  var daily = buildPacingSeries(appIdx, osFilter, ci);
  if(daily.length===0) return '<div class="empty-note">No spend/revenue activity in this scope for the selected range.</div>';
  var monthly = buildPacingMonthly(daily);

  var head = '<thead><tr><th class="namecol">Metric</th>';
  monthly.forEach(function(m){ head += '<th class="pacing-month num">'+esc(fmtMonthLabel(m.month))+(isPacingCurrentMonth(m.month)?"*":"")+'</th>'; });
  head += '<th class="num">%Change</th><th class="num">Target</th>';
  daily.forEach(function(d,i){ head += '<th class="pacing-day num'+(i===0?" pacing-divider":"")+'">'+esc(fmtDayHeaderLabel(d.day))+'</th>'; });
  head += '</tr></thead>';

  var body = '<tbody>';
  PACING_ROWS.forEach(function(row){
    body += '<tr><td class="namecell">'+esc(row.label)+'</td>';
    monthly.forEach(function(m){ body += '<td class="num">'+pacingFmt(row, m[PACING_FIELD_MONTHLY[row.key]])+'</td>'; });
    body += '<td class="num">'+pacingChangeHTML(row, monthly)+'</td>';
    body += '<td class="num">'+pacingTargetHTML(scopeKey, row)+'</td>';
    daily.forEach(function(d,i){ body += '<td class="num'+(i===0?" pacing-divider":"")+'">'+pacingFmt(row, d[PACING_FIELD_DAILY[row.key]])+'</td>'; });
    body += '</tr>';
  });
  body += '</tbody>';
  return '<div class="table-scroll pacing-scroll"><table class="dt pacing-table">'+head+body+'</table></div>';
}
function distinctChannelsForAppOSDaily(appIdx, osFilter){
  var present = new Set();
  for(var i=0;i<DAILY.length;i++){
    var r = DAILY[i];
    if(r[D_AI]!==appIdx) continue;
    if(!osMatches(r[D_OS], osFilter)) continue;
    var day = DAYS[r[D_DI]];
    if(day < state.rangeStart || day > state.rangeEnd) continue;
    present.add(r[D_CI]);
  }
  return [...present].sort(function(a,b){ return CHANNELS[a]<CHANNELS[b]?-1:(CHANNELS[a]>CHANNELS[b]?1:0); });
}
function renderPacing(){
  var out = '<div class="panel" style="margin-bottom:14px;"><div class="panel-head"><h2>Pacing — Overall</h2></div></div>';
  out += '<div class="panel" style="margin-bottom:18px;">'+renderPacingTable("overall", null, "all", null)+'</div>';

  out += '<div class="panel" style="margin-bottom:14px;"><div class="panel-head"><h2>Pacing — by Game / OS / Channel</h2></div></div>';
  out += '<div class="panel"><table class="dt"><tbody>';
  APPS.forEach(function(app, ai){
    var gameKey = "pacing:game:"+ai;
    var gameOpen = state.expanded.has(gameKey);
    out += '<tr class="lvl-channel"><td class="namecell"><div class="namewrap indent-0">'+
      '<button class="disclose'+(gameOpen?" open":"")+'" data-toggle="'+gameKey+'">▶</button>'+
      '<span class="namelabel">'+esc(app)+'</span></div></td></tr>';
    if(gameOpen){
      ["android","ios"].forEach(function(os){
        var channels = distinctChannelsForAppOSDaily(ai, os);
        if(channels.length===0) return;
        var osKey = gameKey+":os:"+os;
        var osOpen = state.expanded.has(osKey);
        out += '<tr class="lvl-campaign"><td class="namecell"><div class="namewrap indent-1">'+
          '<button class="disclose'+(osOpen?" open":"")+'" data-toggle="'+osKey+'">▶</button>'+
          '<span class="namelabel">'+(os==="android"?"Android":"iOS")+'</span></div></td></tr>';
        if(osOpen){
          channels.forEach(function(ci){
            var chKey = osKey+":ch:"+ci;
            var chOpen = state.expanded.has(chKey);
            out += '<tr class="lvl-period"><td class="namecell"><div class="namewrap indent-2">'+
              '<button class="disclose'+(chOpen?" open":"")+'" data-toggle="'+chKey+'">▶</button>'+
              '<span class="namelabel">'+esc(CHANNELS[ci])+'</span></div></td></tr>';
            if(chOpen){
              out += '<tr class="lvl-day"><td style="padding:10px 0 16px;">'+renderPacingTable(chKey, ai, os, ci)+'</td></tr>';
            }
          });
        }
      });
    }
  });
  out += '</tbody></table></div>';
  return out;
}

/* ---------------- events ---------------- */
// Populates the parts of the DOM that depend on DATA but live outside render()'s #app subtree
// (the pull-range display + the rangeStart/rangeEnd inputs' bounds). Safe to call repeatedly —
// once at first boot, and again any time fresh data arrives after that (Retool live refresh).
function syncPullRangeUI(){
  var minEl = document.getElementById("rangeStart");
  var maxEl = document.getElementById("rangeEnd");
  minEl.min = DATA.meta.dateRange[0]; minEl.max = DATA.meta.dateRange[1];
  maxEl.min = DATA.meta.dateRange[0]; maxEl.max = DATA.meta.dateRange[1];
  minEl.value = state.rangeStart; maxEl.value = state.rangeEnd;

  document.getElementById("pullRangeText").textContent = fmtDateLabel(DATA.meta.dateRange[0])+" – "+fmtDateLabel(DATA.meta.dateRange[1]);
  var refreshedEl = document.getElementById("pullRefreshedText");
  if(DATA.meta.refreshedAt){
    var rd = new Date(DATA.meta.refreshedAt);
    refreshedEl.textContent = "refreshed "+rd.toLocaleDateString("en-US",{month:"short",day:"numeric"})+" "+rd.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
    refreshedEl.title = "Full timestamp: "+DATA.meta.refreshedAt+" (UTC)";
  } else {
    refreshedEl.textContent = "";
  }
}

// document.readyState is already past "loading" whenever this script is injected dynamically
// after page load (e.g. a Retool custom component mounting it at runtime) — DOMContentLoaded
// will never fire again in that case, so treat an already-ready document as ready immediately.
var domReady = (document.readyState !== "loading");
var booted = false;
if (!domReady) {
  document.addEventListener("DOMContentLoaded", function(){
    domReady = true;
    if (DATA && !booted) bootUI();
  });
}

// Called by the Retool custom component wrapper (or anything else pushing data in live)
// whenever a fresh dataset is available. Safe before or after boot, and safe to call
// repeatedly — first call boots the UI, later calls just refresh the data and re-render.
window.__dashboardSetData = function(dataset){
  var firstTime = !DATA;
  applyDataset(dataset);
  if (firstTime){
    state.rangeStart = DATA.meta.dateRange[0];
    state.rangeEnd = DATA.meta.dateRange[1];
    if (domReady) bootUI();
  } else {
    // clamp the current view range into the new pull range rather than silently resetting it
    state.rangeStart = clampStr(state.rangeStart, DATA.meta.dateRange[0], DATA.meta.dateRange[1]);
    state.rangeEnd = clampStr(state.rangeEnd, DATA.meta.dateRange[0], DATA.meta.dateRange[1]);
    syncPullRangeUI();
    render();
  }
};

function bootUI(){
  booted = true;
  syncPullRangeUI();
  var minEl = document.getElementById("rangeStart");
  var maxEl = document.getElementById("rangeEnd");
  // native min/max stop the calendar picker itself, but a typed/pasted value can still bypass
  // that in some browsers — clamp explicitly so the view range can never leave the pull range.
  minEl.addEventListener("change", function(){
    var v = clampStr(minEl.value, DATA.meta.dateRange[0], DATA.meta.dateRange[1]);
    if(v<=maxEl.value){ state.rangeStart=v; minEl.value=v; render(); } else minEl.value=state.rangeStart;
  });
  maxEl.addEventListener("change", function(){
    var v = clampStr(maxEl.value, DATA.meta.dateRange[0], DATA.meta.dateRange[1]);
    if(v>=minEl.value){ state.rangeEnd=v; maxEl.value=v; render(); } else maxEl.value=state.rangeEnd;
  });

  document.getElementById("minInstalls").addEventListener("input", function(e){
    var v = parseInt(e.target.value,10); state.minInstalls = isNaN(v)?0:Math.max(0,v); render();
  });
  document.getElementById("trailingDays").addEventListener("input", function(e){
    var v = parseInt(e.target.value,10); state.trailingDays = isNaN(v)?1:Math.max(1,v); render();
  });
  document.getElementById("stopThresh").addEventListener("input", function(e){
    var v=parseFloat(e.target.value); if(!isNaN(v)) state.stopThresh=v/100; render();
  });
  document.getElementById("scaleThresh").addEventListener("input", function(e){
    var v=parseFloat(e.target.value); if(!isNaN(v)) state.scaleThresh=v/100; render();
  });
  document.querySelectorAll("[data-gran]").forEach(function(btn){
    btn.addEventListener("click", function(){ state.granularity=btn.getAttribute("data-gran"); document.querySelectorAll("[data-gran]").forEach(function(b){b.classList.toggle("active",b===btn);}); render(); });
  });
  document.getElementById("rulesToggle").addEventListener("click", function(){ document.getElementById("rulesPanel").classList.toggle("open"); });
  document.addEventListener("click", function(e){
    if(!e.target.closest(".rules-pop")) document.getElementById("rulesPanel").classList.remove("open");
  });

  document.getElementById("simtoggle").addEventListener("click", function(){ document.getElementById("simbar").classList.toggle("open"); });
  document.getElementById("simclose").addEventListener("click", function(){ document.getElementById("simbar").classList.remove("open"); });
  document.getElementById("simclear").addEventListener("click", function(){ state.selected.clear(); render(); });
  document.getElementById("simexport").addEventListener("click", function(){ exportSimCsv(); });
  document.getElementById("simbar").addEventListener("click", function(e){
    var btn = e.target.closest("[data-unselect]");
    if(btn){ state.selected.delete(btn.getAttribute("data-unselect")); render(); }
  });

  document.getElementById("tabbar-slot").addEventListener("click", function(e){
    var btn = e.target.closest("[data-tab]"); if(!btn) return;
    state.activeTab = btn.getAttribute("data-tab"); render();
  });

  document.getElementById("app").addEventListener("click", function(e){
    var t = e.target;
    var toggle = t.closest("[data-toggle]");
    if(toggle){ var key=toggle.getAttribute("data-toggle"); if(state.expanded.has(key)) state.expanded.delete(key); else state.expanded.add(key); render(); return; }
    var osbtn = t.closest("[data-osfilter] [data-os]");
    if(osbtn){ var ai=+t.closest("[data-osfilter]").getAttribute("data-osfilter"); state.osFilter[ai]=osbtn.getAttribute("data-os"); render(); return; }
    var sortTh = t.closest("th[data-sortkey]");
    if(sortTh){
      var sk = sortTh.getAttribute("data-sortkey");
      if(state.sort.key===sk) state.sort.dir = state.sort.dir==="desc" ? "asc" : "desc";
      else state.sort = { key:sk, dir:"desc" };
      render(); return;
    }
    if(t.closest("#resetMultBtn")){ state.multiplierOverrides.clear(); render(); return; }
    var rowResetBtn = t.closest("[data-resetprefix]");
    if(rowResetBtn){
      var prefix = rowResetBtn.getAttribute("data-resetprefix");
      [...state.multiplierOverrides.keys()].forEach(function(k){ if(k.indexOf(prefix+":")===0) state.multiplierOverrides.delete(k); });
      render(); return;
    }
  });
  document.getElementById("app").addEventListener("change", function(e){
    var t=e.target;
    if(t.matches("[data-campsel]")){
      var key=t.getAttribute("data-campsel");
      if(t.checked) state.selected.add(key); else state.selected.delete(key);
      render(); return;
    }
    if(t.matches("[data-chsel]")){
      var parts=t.getAttribute("data-chsel").split(":"); var ai=+parts[0], ci=+parts[1];
      var camps = distinctCampaignsForChannelAnyFilter(ai, ci);
      var turnOn = t.checked;
      camps.forEach(function(cp){ var k=ai+":"+ci+":"+cp; if(turnOn) state.selected.add(k); else state.selected.delete(k); });
      render(); return;
    }
    if(t.matches("[data-colgroup]")){
      state.cols[t.getAttribute("data-colgroup")] = t.checked; render(); return;
    }
    if(t.matches("[data-multkey]")){
      var mkey = t.getAttribute("data-multkey");
      var v = parseFloat(t.value);
      if(t.value===""||isNaN(v)) state.multiplierOverrides.delete(mkey);
      else state.multiplierOverrides.set(mkey, v);
      render(); return;
    }
    if(t.matches("[data-pacingtarget]")){
      var tkey = t.getAttribute("data-pacingtarget");
      var tv = parseFloat(t.value);
      if(t.value===""||isNaN(tv)) state.pacingTargets.delete(tkey);
      else state.pacingTargets.set(tkey, tv);
      render(); return;
    }
  });
  document.body.addEventListener("click", function(e){
    var b=e.target.closest("[data-summary-os] [data-os]");
    if(b){ state.summaryOS = b.getAttribute("data-os"); render(); }
  });
  render();
}
})();
