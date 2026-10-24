import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release, version as osVersion } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

export function fixturePath() {
  const extension = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";
  const file = path.resolve(import.meta.dirname, "../../build/fixture", `ctypes_test_fixture${extension}`);
  if (!existsSync(file)) throw new Error("Fixture missing: run npm run build:test-fixture first");
  return file;
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(samples) {
  const values = samples.map((sample) => sample.ns_per_op).sort((a, b) => a - b);
  const center = median(values);
  return {
    median_ns: center,
    mad_ns: median(values.map((value) => Math.abs(value - center)).sort((a, b) => a - b)),
    samples,
  };
}

function collectMetadata() {
  const root = path.resolve(import.meta.dirname, "../..");
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const cpuInfo = cpus();
  const warnings = [];
  const warn = (message) => {
    warnings.push(message);
    console.warn(`Warning: ${message}`);
  };
  const git = (...args) => {
    const result = spawnSync("git", ["--no-pager", ...args], { cwd: root, encoding: "utf8" });
    if (result.error || result.status !== 0) {
      warn(`Git metadata unavailable (${args.join(" ")}): ${result.error?.message ?? result.stderr.trim()}`);
      return null;
    }
    return result.stdout.trim();
  };
  const commit = git("rev-parse", "HEAD");
  const status = commit === null ? null : git("status", "--porcelain");
  const cpuModel = [...new Set(cpuInfo.map((cpu) => cpu.model))].join("; ");
  if (!cpuModel) warn("CPU model unavailable from node:os.");
  return {
    started_at: new Date().toISOString(), ctypes_version: version,
    os_release: release(), os_version: osVersion(), cpu_model: cpuModel || null, cpu_threads: cpuInfo.length,
    git_commit: commit, git_dirty: status === null ? null : status.length > 0, metadata_warnings: warnings,
  };
}

let sink;

function measureSync(call, duration) {
  const start = performance.now();
  let elapsed;
  let operations = 0;
  do {
    for (let i = 0; i < 1024; i++) sink = call();
    operations += 1024;
    elapsed = performance.now() - start;
  } while (elapsed < duration);
  return { elapsed_ms: elapsed, operations, ns_per_op: elapsed * 1e6 / operations };
}

async function measureAsync(call, concurrency, duration) {
  const start = performance.now();
  let elapsed;
  let operations = 0;
  do {
    sink = concurrency === 1 ? await call() : await Promise.all(Array.from({ length: concurrency }, call));
    operations += concurrency;
    elapsed = performance.now() - start;
  } while (elapsed < duration);
  return { elapsed_ms: elapsed, operations, ns_per_op: elapsed * 1e6 / operations };
}

export async function runComparison(competitor, cases, { version, externalBuffers, notes = [], unsupported = [] } = {}) {
  const { values } = parseArgs({ options: {
    samples: { type: "string", default: "9" },
    duration: { type: "string", default: "250" },
    filter: { type: "string" },
    output: { type: "string" },
  } });
  const samples = Number(values.samples);
  const duration = Number(values.duration);
  if (!Number.isSafeInteger(samples) || samples < 9) throw new RangeError("--samples must be an integer >= 9");
  if (!Number.isFinite(duration) || duration < 250) throw new RangeError("--duration must be at least 250 ms");
  const filters = values.filter?.toLowerCase().split(",");
  const selected = cases.filter((item) => !filters || filters.some((filter) => item.name.toLowerCase().includes(filter)));
  if (!selected.length) throw new Error("No benchmark cases match --filter");
  const htmlFile = values.output
    ? `${path.resolve(values.output).replace(/\.json$/i, "")}.html`
    : path.join(import.meta.dirname, "results", `${competitor.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`);
  mkdirSync(path.dirname(htmlFile), { recursive: true });
  const metadata = collectMetadata();

  console.log(`\nnode-ctypes vs ${competitor}${version ? ` ${version}` : ""}`);
  console.log(`${process.version} | ${process.platform}/${process.arch} | buffers: ${externalBuffers ? "external" : "mirror"}`);
  console.log(`node-ctypes ${metadata.ctypes_version} | CPU: ${metadata.cpu_model ?? "unavailable"} | ${metadata.started_at}`);
  console.log(`${samples} samples per library, each >= ${duration} ms; warmup excluded; alternating library order.`);
  console.log("Times are median +/- MAD in ns/op (async: ns/completed call). Lower is better.");
  console.log(`Ratio = node-ctypes/${competitor}: below 1 favors node-ctypes, above 1 favors ${competitor}.\n`);
  for (const note of notes) console.log(`Note: ${note}`);
  for (const item of unsupported) console.log(`Not compared: ${item}`);

  const width = Math.max(32, ...selected.map((item) => item.name.length));
  const timing = (result) => `${result.median_ns.toFixed(2)} +/- ${result.mad_ns.toFixed(2)}`;
  const report = {
    ...metadata,
    competitor, competitor_version: version ?? null, node: process.version, platform: process.platform, arch: process.arch,
    buffer_mode: externalBuffers ? "external" : "mirror", samples, duration_ms: duration,
    notes, unsupported, cases: [],
  };
  let group;
  for (const [index, item] of selected.entries()) {
    if (item.group !== group) {
      group = item.group;
      console.log(`\n${group}`);
      console.log(`${"Case".padEnd(width)}  ${"node-ctypes".padStart(24)}  ${competitor.padStart(24)}  ${"Ratio".padStart(8)}`);
    }
    const verify = (value) => assert.deepEqual(value, item.expected);
    const calls = [item.ctypes, item.other];
    for (const call of calls) {
      verify(await call());
      for (let i = 0; i < (item.concurrency ? 100 : 10000); i++) {
        if (item.concurrency) sink = await call();
        else sink = call();
      }
    }
    const measurements = [[], []];
    for (let sample = 0; sample < samples; sample++) {
      for (const side of (sample + index) % 2 ? [1, 0] : [0, 1]) {
        const result = item.concurrency
          ? await measureAsync(calls[side], item.concurrency, duration)
          : measureSync(calls[side], duration);
        measurements[side].push(result);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    for (const call of calls) verify(await call());
    const [ctypes, other] = measurements.map(summarize);
    const ratio = ctypes.median_ns / other.median_ns;
    console.log(`${item.name.padEnd(width)}  ${timing(ctypes).padStart(24)}  ${timing(other).padStart(24)}  ${`${ratio.toFixed(2)}x`.padStart(8)}`);
    report.cases.push({
      name: item.name, group, representation: item.representation,
      unit: item.concurrency ? "ns/completed-call" : "ns/op", concurrency: item.concurrency ?? null,
      ctypes, other, ratio,
    });
  }
  sink = undefined;
  report.finished_at = new Date().toISOString();
  console.log("\nNo overall score: compare each workload separately.");
  if (values.output) {
    writeFileSync(values.output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`JSON report: ${values.output}`);
  }
  writeFileSync(htmlFile, renderHtml(report));
  console.log(`HTML report: ${htmlFile}`);
}

function renderHtml(report) {
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const axisNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
  const groups = new Map();
  for (const item of report.cases) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  const competitor = `${report.competitor}${report.competitor_version ? ` ${report.competitor_version}` : ""}`;
  const title = `node-ctypes ${report.ctypes_version} vs ${competitor}`;
  const commit = report.git_commit
    ? `${report.git_commit.slice(0, 12)}${report.git_dirty === null ? " (working tree unavailable)" : report.git_dirty ? " + local changes" : " (clean)"}`
    : "unavailable";
  const platform = ({ darwin: "macOS", win32: "Windows", linux: "Linux" })[report.platform] ?? report.platform;
  const metadata = [
    ["Runtime", `Node.js ${report.node}`, `Buffers: ${report.buffer_mode}`],
    ["Platform", `${platform} / ${report.arch.toUpperCase()}`, `Kernel ${report.os_release}`],
    ["Sampling", `${report.samples} x >= ${report.duration_ms} ms / library`, "Per case; warmup excluded"],
    ["CPU", report.cpu_model ?? "Unavailable", `${report.cpu_threads} logical CPUs`],
  ].map(([label, value, detail]) =>
    `<div><dt>${escape(label)}</dt><dd>${escape(value)}<small>${escape(detail)}</small></dd></div>`).join("\n");
  const sections = [...groups].map(([name, cases], groupIndex) => {
    assert.ok(cases.every((item) => item.unit === cases[0].unit), `${name}: mixed units`);
    const largest = Math.max(...cases.flatMap((item) => [
      item.ctypes.median_ns + item.ctypes.mad_ns, item.other.median_ns + item.other.mad_ns,
    ])) * 1.12;
    const magnitude = 10 ** Math.floor(Math.log10(largest));
    const axisMaximum = Math.ceil(largest / magnitude) * magnitude;
    const percent = (value) => value / axisMaximum * 100;
    const ticks = Array.from({ length: 5 }, (_, index) =>
      `<span style="left:${index * 25}%">${escape(axisNumber.format(axisMaximum * index / 4))}</span>`).join("");
    const charts = cases.map((item) => {
      const ratio = item.ratio.toFixed(2);
      const direction = Number(ratio) - 1;
      const measurements = [
        ["node-ctypes", item.ctypes, "ctypes"], [report.competitor, item.other, "other"],
      ].map(([library, side, className]) => {
        const low = percent(Math.max(0, side.median_ns - side.mad_ns));
        const high = percent(side.median_ns + side.mad_ns);
        const operations = side.samples.reduce((sum, sample) => sum + sample.operations, 0);
        const elapsed = side.samples.reduce((sum, sample) => sum + sample.elapsed_ms, 0) / 1000;
        return `<div class="measurement">
<span class="library">${escape(library)}</span>
<div class="plot" aria-hidden="true"><div class="bar ${className}" style="width:${percent(side.median_ns)}%"></div><div class="whisker" style="left:${low}%;width:${high - low}%"></div></div>
<span class="timing">${escape(decimal.format(side.median_ns))} +/- ${escape(decimal.format(side.mad_ns))}<span class="sr-only"> ${escape(item.unit)}</span></span>
<div class="counts"><span>${escape(integer.format(operations))} ${item.concurrency ? "completed calls" : "operations"}</span><span>${elapsed.toFixed(3)} s measured</span></div>
</div>`;
      }).join("\n");
      return `<article class="case">
<header><h3>${escape(item.name)}</h3><div class="case-meta"><span>${escape(item.representation)}${item.concurrency ? ` / concurrency ${item.concurrency}` : ""}</span><span class="ratio ${direction < 0 ? "good" : direction > 0 ? "other-ahead" : "neutral"}">${ratio}x</span></div></header>
<div class="measurements">${measurements}</div>
</article>`;
    }).join("\n");
    return `<section class="group" aria-labelledby="group-${groupIndex}">
<h2 id="group-${groupIndex}"><span>${String(groupIndex + 1).padStart(2, "0")}</span> ${escape(name)}<small>${cases.length} ${cases.length === 1 ? "case" : "cases"}</small></h2>
<div class="axis"><span class="axis-label">Library</span><div class="ticks">${ticks}</div><span class="unit">Median +/- MAD (${escape(cases[0].unit)})</span></div>
${charts}
</section>`;
  }).join("\n");
  const notes = [
    `CPU: ${report.cpu_model ?? "unavailable"}. OS: ${report.os_version}.`,
    `Commit: ${report.git_commit ?? "unavailable"}; working tree: ${report.git_dirty === null ? "unavailable" : report.git_dirty ? "modified" : "clean"}.`,
    `Started: ${report.started_at}. Finished: ${report.finished_at}.`,
    ...report.notes, ...report.metadata_warnings,
    ...report.unsupported.map((item) => `Not compared: ${item}`),
    "Measured time excludes warmup, result checks and pauses between samples; it is not total wall-clock runtime.",
    "Each section has its own zero-based linear scale. Bar lengths are comparable within a section, not across sections.",
    "Whiskers show median +/- MAD, not a confidence interval. Ratio colors are descriptive, not a significance test.",
    "Ratio below 1 favors node-ctypes (green); above 1 favors the competitor (orange). Rounded ratios of 1.00 are neutral.",
    "Async timing measures completed calls including scheduling. No overall score is computed across workloads.",
  ].map((note) => `<li>${escape(note)}</li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} - benchmark report</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f5f7fb; color: #172033; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 1280px; margin: auto; padding: 24px 32px 40px; }
.hero { padding: 24px; border-radius: 16px; background: #111827; color: white; }
.eyebrow, .run { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; }
.eyebrow { color: #c4b5fd; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; }
h1 { margin: 20px 0; font-size: clamp(24px, 4vw, 32px); line-height: 1.2; }
.run { color: #b9c5d7; font-size: 12px; }
.run strong { color: white; }
.metadata { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; margin: 16px 0; padding: 20px 24px; background: white; border: 1px solid #dbe2ec; border-radius: 12px; }
dt, .axis { color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; }
dd { margin: 8px 0 0; font-size: 16px; font-weight: 650; overflow-wrap: anywhere; }
dd small { display: block; margin-top: 6px; color: #64748b; font-size: 12px; font-weight: 400; }
.guide { margin: 20px 0 28px; color: #64748b; font-size: 12px; }
.guide p { margin: 6px 0; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; }
.legend span { display: inline-flex; align-items: center; gap: 8px; }
.legend p { margin-left: auto; }
.key { display: inline-block; width: 22px; height: 10px; border-radius: 3px; }
.ctypes { background: #8b5cf6; } .other { background: #3b82f6; }
.group { --label-width: 9rem; --value-width: 14rem; --gap: 20px; margin-top: 30px; }
h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 20px; }
h2 > span { color: #64748b; } h2 small { margin-left: auto; color: #64748b; font-size: 12px; font-weight: 400; }
.axis, .measurement { display: grid; grid-template-columns: var(--label-width) minmax(0, 1fr) var(--value-width); column-gap: var(--gap); align-items: center; }
.axis { margin: 16px 0 14px; padding: 0 25px; }
.ticks { position: relative; height: 15px; }
.ticks span { position: absolute; transform: translateX(-50%); }
.unit { text-align: right; text-transform: none; }
.case { margin: 8px 0; overflow: hidden; background: white; border: 1px solid #dbe2ec; border-radius: 9px; break-inside: avoid; }
.case header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 20px; padding: 7px 24px; background: #eef2f8; }
h3 { margin: 0; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.case-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; color: #64748b; font-size: 11px; }
.ratio { min-width: 90px; padding: 2px 12px; border-radius: 6px; text-align: center; font: 700 12px/1.5 "SFMono-Regular", Consolas, monospace; }
.good { color: #166534; background: #dcfce7; } .other-ahead { color: #9a3412; background: #ffedd5; } .neutral { color: #475569; background: #e2e8f0; }
.measurements { padding: 8px 24px; }
.measurement { row-gap: 0; margin: 4px 0 8px; }
.library { grid-column: 1; grid-row: 1; font-size: 13px; font-weight: 600; }
.plot { grid-column: 2; grid-row: 1; position: relative; height: 22px; box-shadow: inset -1px 0 #e2e8f0; background: linear-gradient(to right, #e2e8f0 1px, transparent 1px); background-size: 25% 100%; }
.bar { position: absolute; left: 0; top: 50%; height: 14px; transform: translateY(-50%); border-radius: 3px; }
.whisker { position: absolute; top: 50%; height: 0; border-top: 1.4px solid #172033; }
.whisker::before, .whisker::after { content: ""; position: absolute; top: -5px; height: 8px; border-left: 1.4px solid #172033; }
.whisker::before { left: 0; } .whisker::after { right: 0; }
.timing { grid-column: 3; grid-row: 1; text-align: right; white-space: nowrap; font: 13px/1.5 "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
.counts { grid-column: 2; grid-row: 2; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 12px; color: #64748b; font-size: 11px; }
.method { margin-top: 30px; padding: 16px 24px; border-radius: 12px; background: #e8edf5; color: #475569; font-size: 12px; overflow-wrap: anywhere; }
.method h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.7px; }
.method ul { padding-left: 18px; } .method li { margin: 8px 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 1000px) { .metadata { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  main { padding: 16px; } .hero { padding: 20px; }
  .group { --label-width: 0; --value-width: 0; }
  .axis, .measurement { grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; }
  .axis-label { display: none; } .unit { grid-column: 1 / -1; grid-row: 1; margin-bottom: 10px; text-align: left; }
  .ticks { grid-column: 1 / -1; grid-row: 2; }
  .case header, .measurements { padding-left: 16px; padding-right: 16px; } .axis { padding: 0 17px; }
  .measurement { row-gap: 3px; margin-bottom: 12px; }
  .library { grid-column: 1; grid-row: 1; } .timing { grid-column: 2; grid-row: 1; }
  .plot { grid-column: 1 / -1; grid-row: 2; } .counts { grid-column: 1 / -1; grid-row: 3; }
  .legend p { margin-left: 0; }
}
@media (max-width: 480px) { .metadata { grid-template-columns: minmax(0, 1fr); } .case-meta { width: 100%; justify-content: space-between; } }
@media print { body { background: white; print-color-adjust: exact; -webkit-print-color-adjust: exact; } main { max-width: none; padding: 0; } }
</style>
</head>
<body><main>
<header class="hero"><div class="eyebrow"><span>Benchmark bar charts</span><span>${report.cases.length} cases / ${groups.size} groups</span></div>
<h1>${escape(title)}</h1><div class="run"><span><time datetime="${escape(report.started_at)}">${escape(report.started_at)}</time> | Commit ${escape(commit)}</span><strong>SHORTER BARS ARE BETTER</strong></div></header>
<dl class="metadata">${metadata}</dl>
<section class="guide" aria-label="How to read the charts">
<div class="legend"><span><i class="key ctypes"></i>node-ctypes</span><span><i class="key other"></i>${escape(report.competitor)}</span><p>Ratio = node-ctypes / ${escape(report.competitor)}; below 1 favors node-ctypes</p></div>
<p>Time per operation: lower is better. Linear scales start at zero and are shared within each section; different sections use different scales.</p>
<p>Bars show medians; black whiskers show +/- MAD, not confidence intervals. Counts and measured times are totals.</p>
</section>
${sections}
<section class="method" aria-labelledby="method"><h2 id="method">Method &amp; provenance</h2><ul>${notes}</ul></section>
</main></body>
</html>
`;
}
