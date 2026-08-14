// Fonts never change, so rather than storing a ~100KB base64 blob as a pipeline asset, just
// re-fetch and re-encode them fresh each run — deterministic, same bytes every time.
import { writeFileSync } from "fs";

const FONT_URLS = {
  archivo: "https://fonts.gstatic.com/s/archivo/v25/k3kPo8UDI-1M0wlSV9XAw6lQkqWY8Q82sLydOxI.woff2",
  plexmono400: "https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2",
  plexmono500: "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2",
  plexmono600: "https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2",
};

const out = {};
for (const [key, url] of Object.entries(FONT_URLS)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed for ${key}: status ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  out[key] = buf.toString("base64");
}

writeFileSync(new URL("./fonts_b64.json", import.meta.url), JSON.stringify(out));
console.log("Saved fonts_b64.json:", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
