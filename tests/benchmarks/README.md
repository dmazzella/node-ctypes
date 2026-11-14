# Benchmarks

Side-by-side comparisons of node-ctypes with other FFI libraries, calling the
same C functions of the shared test fixture. They measure performance only and
are not run by the test suite. The method and the published results are in
[Performance](../../guides/performance.md).

| File                                             | What it does                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [benchmark_koffi.js](./benchmark_koffi.js)       | node-ctypes vs Koffi (`npm run bench:koffi`, Node 24+)                    |
| [benchmark_node_ffi.js](./benchmark_node_ffi.js) | node-ctypes vs `node:ffi` (`npm run bench:ffi`, Node 26+)                 |
| [runner.js](./runner.js)                         | sampling, console table, JSON (`--output`) and HTML report shared by both |
| [charts.js](./charts.js)                         | SVG charts for the guides from a JSON report (`npm run bench:charts`)     |
| [benchmark_python.py](./benchmark_python.py)     | standalone Python ctypes timings (`npm --prefix tests run bench:python`)  |
| `results/`                                       | default HTML reports, ignored by Git                                      |

## Running a comparison

From the repository root, after building node-ctypes:

```bash
npm --prefix tests install          # once: installs Koffi
npm run build:test-fixture          # the C functions both libraries call
npm run bench:koffi                 # table on the console, results/koffi.html
```

Run one comparison at a time, on an otherwise idle machine. `--filter`,
`--samples`, `--duration` and `--output` are described in
[Running the comparisons](../../guides/performance.md#running-the-comparisons);
the workloads of each comparison in the [test suite guide](../README.md).

## Updating the published results

The charts and tables of [Performance](../../guides/performance.md) come from
one run of `bench:koffi`. To replace them with a new run:

1. Run the comparison saving the JSON report (this also writes `koffi.html`
   next to it):

   ```bash
   npm run bench:koffi -- --output tests/benchmarks/results/koffi.json
   ```

2. Regenerate the charts. This overwrites `guides/images/koffi-*.svg`: the
   ratio summary and one chart per workload group, with light and dark colors.
   File names depend only on the competitor and the group, so the links in the
   page stay valid.

   ```bash
   npm run bench:charts -- tests/benchmarks/results/koffi.json
   ```

   With `--out <directory>` the charts are written elsewhere, for example to
   look at them first, or for a run on another machine that must not replace
   the published one.

3. Update `guides/performance.md` by hand; `charts.js` does not edit Markdown:
   - the description of the run under **Results**: node-ctypes, Node.js and
     Koffi versions, the machine (also whether it is a virtual machine) and the
     date;
   - the tables: the node-ctypes and Koffi times and the ratio, from the
     console table or from `median_ns` of `ctypes` and `other` in the JSON;
   - for a new workload group, a `###` heading with its image
     (`images/koffi-<group>.svg`) and its table, like the others.

4. Check the site with `npm run docs` (no warnings; the SVG files are copied to
   `docs/media`), then commit `guides/images/` and `guides/performance.md`.
   The JSON and HTML reports stay in `results/`, ignored by Git.

A `bench:ffi` report (`--output tests/benchmarks/results/node-ffi.json`) gives
`node-ffi-*.svg` charts in the same way; the guides do not show them yet.
