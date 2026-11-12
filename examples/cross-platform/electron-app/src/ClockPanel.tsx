import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NativeClockSnapshot } from "../electron/native-clock-api";
import { AnalogClock, type ClockAnchor } from "./AnalogClock";

// The digital clock: ten updates a second are smooth and readable, and cheap to
// paint (every frame would mostly repaint digits no one can read).
const DIGITAL_INTERVAL_MS = 100;

/**
 * The operating system clock. Each native reading (once a second) anchors the
 * time; between readings the display advances by the time elapsed since the
 * reading arrived (performance.now()).
 */
export function ClockPanel({ snapshot }: { snapshot: NativeClockSnapshot }) {
  const nativeMilliseconds = Number(BigInt(snapshot.epochNanoseconds) / 1000000n);
  // Set before the first paint and on every reading (layout effect: before the timers start).
  const anchor = useRef<ClockAnchor>({ epoch: nativeMilliseconds, at: 0 });
  const [now, setNow] = useState(nativeMilliseconds);

  useLayoutEffect(() => {
    anchor.current = { epoch: nativeMilliseconds, at: performance.now() };
  }, [nativeMilliseconds]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(anchor.current.epoch + (performance.now() - anchor.current.at)), DIGITAL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const iso = new Date(now).toISOString();
  return (
    <article className="panel clock-panel">
      <div className="panel-heading">
        <span className="eyebrow">OPERATING SYSTEM CLOCK</span>
        <span className="tag">UTC &middot; native read every second</span>
      </div>
      <div className="clock-body">
        <div>
          <time className="clock-value" dateTime={iso}>
            {iso.slice(11, 23)}
          </time>
          <p className="clock-date">{iso.slice(0, 10)}</p>
          <div className="reading-detail">
            <span>Nanoseconds since Unix epoch, last native read</span>
            <code>{snapshot.epochNanoseconds}</code>
          </div>
          <code className="api-name">{snapshot.clockApi}</code>
        </div>
        <AnalogClock anchor={anchor} />
      </div>
    </article>
  );
}
