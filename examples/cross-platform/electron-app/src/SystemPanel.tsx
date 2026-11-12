import { useEffect, useState } from "react";
import type { NativeSystemSnapshot } from "../electron/native-system-api";
import { DISPLAY_DELAY_MS, MemoryChart, type MemorySample } from "./MemoryChart";

const WINDOW_SECONDS = 60;

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function duration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days} d ${hours} h ${minutes} min` : hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** Memory and uptime from the operating system, sampled every second. */
export function SystemPanel() {
  const [snapshot, setSnapshot] = useState<NativeSystemSnapshot | null>(null);
  const [samples, setSamples] = useState<MemorySample[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let reading = false;
    const readSystem = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        if (!window.nativeSystem) throw new Error("The native bridge is unavailable. Start this application in Electron, not a browser.");
        const value = await window.nativeSystem.read();
        if (!active) return;
        const usedBytes = value.totalMemoryBytes - value.availableMemoryBytes;
        const sample = { time: value.sampledAt, usedPercent: (usedBytes / value.totalMemoryBytes) * 100, usedBytes, totalBytes: value.totalMemoryBytes };
        setSnapshot(value);
        setSamples((previous) => [...previous.filter((item) => item.time > value.sampledAt - WINDOW_SECONDS * 1000 - DISPLAY_DELAY_MS - 1000), sample]);
        setError(null);
      } catch (cause: unknown) {
        console.error("Native system request failed:", cause);
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };

    void readSystem();
    const timer = window.setInterval(() => void readSystem(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const latest = samples[samples.length - 1];
  return (
    <section className="panel system-panel" aria-labelledby="system-heading">
      <div className="panel-heading">
        <h2 id="system-heading">Memory in use</h2>
        <span className="tag">last {WINDOW_SECONDS} s</span>
      </div>
      {error && (
        <p className="system-error" role="alert">
          {error}
        </p>
      )}
      {snapshot && latest && (
        <>
          <dl className="system-stats">
            <div>
              <dt>In use</dt>
              <dd>{latest.usedPercent.toFixed(1)}%</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>
                {gigabytes(snapshot.availableMemoryBytes)} <span>of {gigabytes(snapshot.totalMemoryBytes)}</span>
              </dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{duration(snapshot.uptimeSeconds)}</dd>
            </div>
          </dl>
          <MemoryChart samples={samples} windowSeconds={WINDOW_SECONDS} />
          <ul className="system-apis">
            <li>
              <code>{snapshot.memoryApi}</code> fills a {snapshot.memoryStructBytes}-byte C structure
            </li>
            <li>
              <code>{snapshot.uptimeApi}</code>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
