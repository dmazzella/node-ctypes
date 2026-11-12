import { useEffect, useRef, type RefObject } from "react";
import * as echarts from "echarts/core";
import { GaugeChart } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";

// The gauge-clock layout of the ECharts examples: three gauges (hours,
// minutes, seconds) sharing one dial.
echarts.use([GaugeChart, CanvasRenderer]);

const DIAL = "#24333f";
const TICK = "#5d7182";
const LABEL = "#829aaa";
const HAND = "#eaf2f6";
const SECOND_HAND = "#93edc6";

const dial = (max: number) => ({
  type: "gauge" as const,
  startAngle: 90,
  endAngle: -270,
  min: 0,
  max,
  splitNumber: 12,
  clockwise: true,
  title: { show: false },
  detail: { show: false },
});

const baseOption = {
  animation: false,
  series: [
    {
      ...dial(12),
      name: "hour",
      axisLine: { lineStyle: { width: 4, color: [[1, DIAL]] } },
      splitLine: { distance: 4, length: 8, lineStyle: { width: 2, color: TICK } },
      axisTick: { distance: 4, length: 4, splitNumber: 5, lineStyle: { width: 1, color: DIAL } },
      axisLabel: { distance: 12, fontSize: 11, color: LABEL, formatter: (value: number) => (value === 0 ? "" : String(value)) },
      pointer: { icon: "roundRect", width: 5, length: "50%", offsetCenter: [0, "8%"], itemStyle: { color: HAND } },
      data: [{ value: 0 }],
    },
    {
      ...dial(60),
      name: "minute",
      axisLine: { show: false },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      pointer: { icon: "roundRect", width: 3.5, length: "68%", offsetCenter: [0, "8%"], itemStyle: { color: HAND } },
      data: [{ value: 0 }],
    },
    {
      ...dial(60),
      name: "second",
      axisLine: { show: false },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      pointer: { icon: "roundRect", width: 1.5, length: "78%", offsetCenter: [0, "12%"], itemStyle: { color: SECOND_HAND } },
      anchor: { show: true, size: 8, showAbove: true, itemStyle: { color: SECOND_HAND, borderColor: DIAL, borderWidth: 2 } },
      data: [{ value: 0 }],
    },
  ],
};

/** The last native reading (`epoch`, ms since the Unix epoch) and when it arrived (`at`, performance.now()). */
export interface ClockAnchor {
  epoch: number;
  at: number;
}

// A smooth sweep for the second hand, at a fraction of the cost of every frame.
const FRAME_INTERVAL_MS = 1000 / 20;

/**
 * An analog clock (UTC) drawn with ECharts gauges. It redraws only its canvas,
 * from `anchor` and the time elapsed since it arrived: no React render per frame.
 */
export function AnalogClock({ anchor }: { anchor: RefObject<ClockAnchor> }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = echarts.init(element, null, { renderer: "canvas" });
    instance.setOption(baseOption);
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(element);
    let drawn = 0;
    let frame = requestAnimationFrame(function draw(frameTime) {
      frame = requestAnimationFrame(draw);
      if (frameTime - drawn < FRAME_INTERVAL_MS) return;
      drawn = frameTime;
      const time = new Date(anchor.current.epoch + (performance.now() - anchor.current.at));
      const seconds = time.getUTCSeconds() + time.getUTCMilliseconds() / 1000;
      const minutes = time.getUTCMinutes() + seconds / 60;
      const hours = (time.getUTCHours() % 12) + minutes / 60;
      instance.setOption({ series: [hours, minutes, seconds].map((value) => ({ data: [{ value }] })) });
      element.setAttribute("aria-label", `Analog clock: ${time.toISOString().slice(11, 16)} UTC.`);
    });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      instance.dispose();
    };
  }, [anchor]);

  return <div ref={container} className="analog-clock" role="img" aria-label="Analog clock (UTC)." />;
}
