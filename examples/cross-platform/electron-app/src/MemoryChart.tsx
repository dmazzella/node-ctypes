import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Only the parts this chart uses (smaller bundle than the full "echarts").
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface MemorySample {
  time: number;
  usedPercent: number;
  usedBytes: number;
  totalBytes: number;
}

/**
 * The chart shows up to this long ago: a new sample (one a second) enters at
 * the right edge as the axis scrolls, instead of appearing with a jump.
 */
export const DISPLAY_DELAY_MS = 1000;
// Redraws of the scrolling axis: smooth, and a third of the cost of every frame.
const FRAME_INTERVAL_MS = 1000 / 20;

const SERIES = "#3987e5";
const MUTED = "#829aaa";
const GRID = "#24333f";
const SURFACE = "#111b24";
const INK = "#eaf2f6";

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Memory in use over time: one series, so the panel title names it (no legend). */
export function MemoryChart({ samples, windowSeconds }: { samples: MemorySample[]; windowSeconds: number }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const current = useRef(samples);

  // The chart, and its axis scrolling on its own (no ECharts animation).
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = echarts.init(element, null, { renderer: "canvas" });
    instance.setOption({
      animation: false,
      grid: { left: 44, right: 12, top: 12, bottom: 12 },
      tooltip: {
        trigger: "axis",
        backgroundColor: SURFACE,
        borderColor: GRID,
        textStyle: { color: INK, fontSize: 12 },
        axisPointer: { type: "line", lineStyle: { color: MUTED, width: 1 } },
        formatter: (params: unknown) => {
          const point = (params as { dataIndex: number }[])[0];
          const sample = point ? current.current[point.dataIndex] : undefined;
          if (!sample) return "";
          const time = new Date(sample.time).toLocaleTimeString();
          return `${time}<br/><strong>${sample.usedPercent.toFixed(1)}%</strong> in use · ${gigabytes(sample.usedBytes)} of ${gigabytes(sample.totalBytes)}`;
        },
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: GRID } },
        axisTick: { show: false },
        splitLine: { show: false },
        // No time labels: the panel tag says "last 60 s", and the tooltip gives the time.
        axisLabel: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        interval: 25,
        axisLabel: { color: MUTED, fontSize: 11, formatter: "{value}%" },
        splitLine: { lineStyle: { color: GRID, width: 1 } },
      },
      series: [
        {
          type: "line",
          name: "Memory in use",
          data: [],
          showSymbol: false,
          lineStyle: { color: SERIES, width: 2 },
          itemStyle: { color: SERIES },
          areaStyle: { color: SERIES, opacity: 0.16 },
        },
      ],
    });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(element);
    let drawn = 0;
    let frame = requestAnimationFrame(function scroll(frameTime) {
      frame = requestAnimationFrame(scroll);
      if (frameTime - drawn < FRAME_INTERVAL_MS) return;
      drawn = frameTime;
      const right = Date.now() - DISPLAY_DELAY_MS;
      instance.setOption({ xAxis: { min: right - windowSeconds * 1000, max: right } });
    });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [windowSeconds]);

  // The data: once a second, when a sample arrives.
  useEffect(() => {
    current.current = samples;
    chart.current?.setOption({ series: [{ data: samples.map((sample) => [sample.time, sample.usedPercent]) }] });
  }, [samples]);

  const latest = samples[samples.length - 1];
  return <div ref={container} className="memory-chart" role="img" aria-label={latest ? `Memory in use over the last ${windowSeconds} seconds; now ${latest.usedPercent.toFixed(1)}%.` : "Memory in use: waiting for the first sample."} />;
}
