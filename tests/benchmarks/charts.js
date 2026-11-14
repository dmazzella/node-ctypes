// Static SVG charts from a comparison JSON report (`npm run bench:koffi -- --output file.json`):
// a ratio summary and one chart per workload group, for the guides. Usage:
//   node tests/benchmarks/charts.js report.json [--out guides/images]
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: path.resolve(import.meta.dirname, "../../guides/images") } },
});
if (positionals.length !== 1) throw new Error("Usage: node tests/benchmarks/charts.js report.json [--out dir]");
const report = JSON.parse(readFileSync(positionals[0], "utf8"));
const competitor = report.competitor;
const prefix = competitor.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-");

// Validated categorical pair (blue / orange), light and dark steps, and the chart surfaces.
const STYLE = `
.surface { fill: #fcfcfb; } .primary { fill: #0b0b0b; } .secondary { fill: #52514e; }
.ctypes { fill: #2a78d6; } .other { fill: #eb6834; }
.grid { stroke: #e4e3df; stroke-width: 1; } .baseline { stroke: #52514e; stroke-width: 1; }
.whisker { stroke: #0b0b0b; stroke-width: 1.2; }
text { font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
.title { font-size: 15px; font-weight: 600; } .small { font-size: 11px; } .group { font-weight: 600; }
.value { font-variant-numeric: tabular-nums; }
@media (prefers-color-scheme: dark) {
  .surface { fill: #1a1a19; } .primary { fill: #f0efec; } .secondary { fill: #c3c2b7; }
  .ctypes { fill: #3987e5; } .other { fill: #d95926; }
  .grid { stroke: #383835; } .baseline { stroke: #c3c2b7; } .whisker { stroke: #f0efec; }
}`;

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Approximate width of 12px sans-serif text, enough to size the label column.
const textWidth = (text) => text.length * 6.6;
const ns = (value) => (value >= 1000 ? value.toFixed(0) : value >= 100 ? value.toFixed(1) : value.toFixed(2));
const ratioText = (ratio) => `${ratio.toFixed(2)}x`;
const ratioOf = (item) => item.ctypes.median_ns / item.other.median_ns;
// Rounded on the data end only, anchored square on the baseline.
function bar(x0, x1, y, height, cls, title) {
  const left = Math.min(x0, x1);
  const width = Math.max(Math.abs(x1 - x0), 1);
  const r = Math.min(4, width / 2, height / 2);
  const d =
    x1 >= x0
      ? `M${left},${y}h${width - r}a${r},${r} 0 0 1 ${r},${r}v${height - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${width - r}z`
      : `M${left + width},${y}v${height}h-${width - r}a${r},${r} 0 0 1 -${r},-${r}v-${height - 2 * r}a${r},${r} 0 0 1 ${r},-${r}z`;
  return `<path class="${cls}" d="${d}"><title>${escape(title)}</title></path>`;
}
function legend(x, y, entries) {
  let out = "";
  for (const [cls, label] of entries) {
    out += `<rect class="${cls}" x="${x}" y="${y - 9}" width="10" height="10" rx="2"/><text class="secondary" x="${x + 15}" y="${y}">${escape(label)}</text>`;
    x += 15 + textWidth(label) + 20;
  }
  return out;
}
function svg(width, height, label, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}">
<title>${escape(label)}</title>
<style>${STYLE}
</style>
<rect class="surface" width="${width}" height="${height}" rx="8"/>
${body}
</svg>
`;
}
function niceTicks(max) {
  const step = 10 ** Math.floor(Math.log10(max / 4));
  const factor = [1, 2, 2.5, 5, 10].find((f) => max / (step * f) <= 5);
  const size = step * factor;
  const ticks = [];
  for (let value = 0; value <= max + size * 1e-9; value += size) ticks.push(value);
  if (ticks.at(-1) < max) ticks.push(ticks.at(-1) + size);
  return ticks;
}
const tickText = (value) => (value >= 1000 ? `${value / 1000}k` : String(+value.toFixed(2)));
const subtitle = `${report.platform}/${report.arch}, Node.js ${report.node.replace(/^v/, "")}, node-ctypes ${report.ctypes_version}, ${competitor} ${report.competitor_version}`;

const groups = new Map();
for (const item of report.cases) {
  if (!item.ctypes || !item.other) continue;
  if (!groups.has(item.group)) groups.set(item.group, []);
  groups.get(item.group).push(item);
}

const files = [];
function save(name, content) {
  const file = path.join(values.out, name);
  writeFileSync(file, content);
  files.push(file);
}
mkdirSync(values.out, { recursive: true });

// One chart per group: node-ctypes and competitor medians, MAD whiskers, shared linear scale from zero.
for (const [group, items] of groups) {
  const unit = items[0].concurrency ? "ns per completed call" : "ns per call";
  const labelWidth = Math.max(...items.map((item) => textWidth(item.name))) + 24;
  const plotWidth = 420;
  const ratioWidth = 64;
  const width = Math.round(labelWidth + plotWidth + ratioWidth + 24);
  const rowHeight = 34;
  const top = 78;
  const height = top + items.length * rowHeight + 34;
  const ticks = niceTicks(Math.max(...items.flatMap((item) => [item.ctypes.median_ns + item.ctypes.mad_ns, item.other.median_ns + item.other.mad_ns])));
  const x = (value) => labelWidth + (value / ticks.at(-1)) * plotWidth;
  let body = `<text class="primary title" x="16" y="26">${escape(group)}</text>`;
  body += `<text class="secondary small" x="16" y="44">Median ${unit}, lower is better; whiskers: +/- MAD. ${escape(subtitle)}</text>`;
  body += legend(16, 66, [
    ["ctypes", "node-ctypes"],
    ["other", competitor],
  ]);
  body += `<text class="secondary small" x="${width - 16}" y="66" text-anchor="end">ratio</text>`;
  const bottom = top + items.length * rowHeight;
  for (const tick of ticks) {
    body += `<line class="grid" x1="${x(tick)}" y1="${top - 4}" x2="${x(tick)}" y2="${bottom}"/>`;
    body += `<text class="secondary small value" x="${x(tick)}" y="${bottom + 16}" text-anchor="middle">${tickText(tick)}</text>`;
  }
  items.forEach((item, index) => {
    const y = top + index * rowHeight;
    body += `<text class="primary" x="${labelWidth - 12}" y="${y + 17}" text-anchor="end">${escape(item.name)}</text>`;
    for (const [key, cls, name, offset] of [
      ["ctypes", "ctypes", "node-ctypes", 4],
      ["other", "other", competitor, 16],
    ]) {
      const { median_ns: median, mad_ns: mad } = item[key];
      body += bar(x(0), x(median), y + offset, 10, cls, `${item.name}, ${name}: ${ns(median)} +/- ${ns(mad)} ns`);
      if (mad > 0) {
        const lo = x(Math.max(0, median - mad));
        const hi = x(median + mad);
        body += `<path class="whisker" d="M${lo},${y + offset + 5}H${hi}M${lo},${y + offset + 2}v6M${hi},${y + offset + 2}v6"/>`;
      }
    }
    body += `<text class="primary value" x="${width - 16}" y="${y + 17}" text-anchor="end">${ratioText(ratioOf(item))}</text>`;
  });
  body += `<line class="baseline" x1="${x(0)}" y1="${top - 4}" x2="${x(0)}" y2="${bottom}"/>`;
  save(`${prefix}-${slug(group)}.svg`, svg(width, height, `${group}: node-ctypes vs ${competitor}, ${unit}`, body));
}

// Summary: every ratio on a log scale centered on 1x, so 0.5x and 2x are the same distance.
{
  const all = [...groups.values()].flat();
  const labelWidth = Math.max(...all.map((item) => textWidth(item.name))) + 24;
  const plotWidth = 420;
  const width = Math.round(labelWidth + plotWidth + 60);
  const rowHeight = 20;
  const groupGap = 26;
  const top = 86;
  const height = top + all.length * rowHeight + groups.size * groupGap + 30;
  const ratios = all.map(ratioOf);
  const candidates = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16];
  // Margins leave room for the value labels at the ends of the bars.
  const low = Math.min(...ratios, 1) / 1.7;
  const high = Math.max(...ratios, 1) * 1.4;
  const x = (ratio) => labelWidth + ((Math.log(ratio) - Math.log(low)) / (Math.log(high) - Math.log(low))) * plotWidth;
  let body = `<text class="primary title" x="16" y="26">node-ctypes time / ${escape(competitor)} time</text>`;
  body += `<text class="secondary small" x="16" y="44">Ratio of the medians, log scale: below 1x node-ctypes is faster. ${escape(subtitle)}</text>`;
  body += legend(16, 66, [
    ["ctypes", "node-ctypes faster"],
    ["other", `${competitor} faster`],
  ]);
  const bottom = height - 30;
  for (const tick of candidates.filter((tick) => tick >= low && tick <= high)) {
    body += `<line class="${tick === 1 ? "baseline" : "grid"}" x1="${x(tick)}" y1="${top - 4}" x2="${x(tick)}" y2="${bottom}"/>`;
    body += `<text class="secondary small value" x="${x(tick)}" y="${bottom + 16}" text-anchor="middle">${tick}x</text>`;
  }
  let y = top;
  for (const [group, items] of groups) {
    y += groupGap;
    body += `<text class="primary group" x="16" y="${y - 8}">${escape(group)}</text>`;
    for (const item of items) {
      const ratio = ratioOf(item);
      body += `<text class="primary" x="${labelWidth - 12}" y="${y + 14}" text-anchor="end">${escape(item.name)}</text>`;
      body += bar(x(1), x(ratio), y + 5, 12, ratio < 1 ? "ctypes" : "other", `${item.name}: ${ratioText(ratio)}`);
      const end = x(ratio);
      body += `<text class="primary small value" x="${ratio < 1 ? end - 6 : end + 6}" y="${y + 15}" text-anchor="${ratio < 1 ? "end" : "start"}">${ratioText(ratio)}</text>`;
      y += rowHeight;
    }
  }
  save(`${prefix}-summary.svg`, svg(width, height, `node-ctypes time divided by ${competitor} time, per case`, body));
}

for (const file of files) console.log(file);
