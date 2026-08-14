// Computes the Adjust "pull range" per the agreed rule:
//   end   = D-1 relative to "now" (yesterday, since "today" is always partial in Adjust)
//   start = floor(end - 3 calendar months) to the 1st of that month, then snapped back to
//           the Monday of the week containing that 1st (weeks are always Mon-Sun).
// This means start only moves forward once per month (when the "-3 months" date crosses a
// month boundary), not every day, and start is always a Monday.
export function isoDate(d) { return d.toISOString().slice(0, 10); }

export function computePullRange(now) {
  const end = new Date(now.getTime() - 86400000); // D-1
  const Y = end.getUTCFullYear(), M = end.getUTCMonth();
  let M2 = M - 3, Y2 = Y;
  if (M2 < 0) { M2 += 12; Y2 -= 1; }
  const monthFirst = new Date(Date.UTC(Y2, M2, 1));
  const dow = monthFirst.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const start = new Date(monthFirst.getTime() - daysSinceMonday * 86400000);
  return { start: isoDate(start), end: isoDate(end) };
}
