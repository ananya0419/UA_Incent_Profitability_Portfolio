// Retool JS Query named: pullRange
// No inputs. Returns { start, end } — the same rolling 3-month pull-range rule verified
// earlier: end = D-1; start = the 1st of the month 3 months back from end, snapped to
// the Monday of its week. Ported verbatim from pullrange.mjs.

function isoDate(d) { return d.toISOString().slice(0, 10); }

const now = new Date();
const end = new Date(now.getTime() - 86400000); // D-1
const Y = end.getUTCFullYear(), M = end.getUTCMonth();
let M2 = M - 3, Y2 = Y;
if (M2 < 0) { M2 += 12; Y2 -= 1; }
const monthFirst = new Date(Date.UTC(Y2, M2, 1));
const dow = monthFirst.getUTCDay(); // 0=Sun..6=Sat
const daysSinceMonday = (dow + 6) % 7; // Mon=0 .. Sun=6
const start = new Date(monthFirst.getTime() - daysSinceMonday * 86400000);

return { start: isoDate(start), end: isoDate(end) };
