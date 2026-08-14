import { readFileSync, writeFileSync } from "fs";

const dir = new URL("./", import.meta.url);
const css = readFileSync(new URL("dashboard.css", dir), "utf8");
const js = readFileSync(new URL("dashboard.js", dir), "utf8");
const body = readFileSync(new URL("body.html", dir), "utf8");
const dataset = readFileSync(new URL("dataset.json", dir), "utf8");
const fonts = JSON.parse(readFileSync(new URL("fonts_b64.json", dir), "utf8"));

let cssFinal = css
  .replace("__ARCHIVO_B64__", fonts.archivo)
  .replace("__PLEXMONO400_B64__", fonts.plexmono400)
  .replace("__PLEXMONO500_B64__", fonts.plexmono500)
  .replace("__PLEXMONO600_B64__", fonts.plexmono600);

const titleMatch = body.match(/^<title>.*<\/title>\n*/);
const titleTag = titleMatch ? titleMatch[0] : "";
const restBody = titleMatch ? body.slice(titleMatch[0].length) : body;

const out = [
  titleTag,
  "<style>", cssFinal, "</style>",
  restBody,
  "<script>window.__DASHBOARD_DATA__ = ", dataset, ";</script>",
  "<script>", js, "</script>",
].join("\n");

writeFileSync(new URL("dashboard_final.html", dir), out);
console.log("Final HTML size (KB):", Math.round(out.length / 1024));
