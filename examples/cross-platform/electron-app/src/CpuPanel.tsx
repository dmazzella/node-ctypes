import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CoreUsage, NativeCpuSnapshot } from "../electron/native-cpu-api";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const SERIES = "#3987e5";
const MUTED = "#829aaa";
const GRID = "#24333f";
const SURFACE = "#111b24";
const INK = "#eaf2f6";

// Axis label for a processor: "0,3" (Windows, group 0) and "cpu3" (Linux) read as "3".
const shortName = (name: string) => name.replace(/^0,/, "").replace(/^cpu/, "");

/** One bar per logical processor: usage in the last second, 0-100%. */
function CoreChart({ cores }: { cores: CoreUsage[] }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const current = useRef(cores);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = echarts.init(element, null, { renderer: "canvas" });
    instance.setOption({
      // A short transition to each new reading (once a second).
      animationDuration: 0,
      animationDurationUpdate: 300,
      animationEasingUpdate: "cubicOut",
      grid: { left: 44, right: 8, top: 12, bottom: 28 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(130, 154, 170, 0.08)" } },
        backgroundColor: SURFACE,
        borderColor: GRID,
        textStyle: { color: INK, fontSize: 12 },
        formatter: (params: unknown) => {
          const point = (params as { dataIndex: number }[])[0];
          const core = point ? current.current[point.dataIndex] : undefined;
          return core ? `Processor ${core.name}<br/><strong>${core.percent.toFixed(1)}%</strong> busy` : "";
        },
      },
      xAxis: {
        type: "category",
        data: [],
        axisLine: { lineStyle: { color: GRID } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: { color: MUTED, fontSize: 11, formatter: "{value}%" },
        splitLine: { lineStyle: { color: GRID, width: 1 } },
      },
      series: [{ type: "bar", name: "Processor usage", data: [], barMaxWidth: 28, itemStyle: { color: SERIES, borderRadius: [4, 4, 0, 0] } }],
    });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(element);
    return () => {
      resize.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    current.current = cores;
    chart.current?.setOption({
      xAxis: { data: cores.map((core) => shortName(core.name)) },
      series: [{ data: cores.map((core) => Math.min(100, Math.max(0, core.percent))) }],
    });
  }, [cores]);

  const busiest = cores.reduce<CoreUsage | null>((max, core) => (!max || core.percent > max.percent ? core : max), null);
  return <div ref={container} className="core-chart" role="img" aria-label={busiest ? `Usage of ${cores.length} logical processors; the busiest, ${busiest.name}, at ${busiest.percent.toFixed(0)}%.` : "Processor usage: measuring."} />;
}

/** Processor usage from the operating system, sampled every second. */
export function CpuPanel() {
  const [snapshot, setSnapshot] = useState<NativeCpuSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let reading = false;
    const readCpu = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        if (!window.nativeCpu) throw new Error("The native bridge is unavailable. Start this application in Electron, not a browser.");
        const value = await window.nativeCpu.read();
        if (active) {
          setSnapshot(value);
          setError(null);
        }
      } catch (cause: unknown) {
        console.error("Native CPU request failed:", cause);
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };

    void readCpu();
    const timer = window.setInterval(() => void readCpu(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="panel cpu-panel" aria-labelledby="cpu-heading">
      <div className="panel-heading">
        <h2 id="cpu-heading">Processor usage</h2>
        <span className="tag">{snapshot ? `${snapshot.cores.length} logical processors` : "measuring"}</span>
      </div>
      {error && (
        <p className="system-error" role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <>
          <dl className="system-stats cpu-stats">
            <div>
              <dt>Total, last second</dt>
              <dd>{snapshot.totalPercent === null ? "measuring" : `${snapshot.totalPercent.toFixed(1)}%`}</dd>
            </div>
          </dl>
          <CoreChart cores={snapshot.cores} />
          <ul className="system-apis">
            <li>
              <code>{snapshot.api}</code>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
