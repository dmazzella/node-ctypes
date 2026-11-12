import { useEffect, useState } from "react";
import type { NativeClockSnapshot } from "../electron/native-clock-api";
import type { NativeRuntimeInfo } from "../electron/native-runtime-api";
import { ClockPanel } from "./ClockPanel";
import { CpuPanel } from "./CpuPanel";
import { SystemPanel } from "./SystemPanel";
import "./App.css";

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const BRIDGE_UNAVAILABLE = "The native bridge is unavailable. Start this application in Electron, not a browser.";

function App() {
  const [runtime, setRuntime] = useState<NativeRuntimeInfo | null>(null);
  const [snapshot, setSnapshot] = useState<NativeClockSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Versions and process identity: once.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!window.nativeRuntime) throw new Error(BRIDGE_UNAVAILABLE);
        const value = await window.nativeRuntime.read();
        if (active) setRuntime(value);
      } catch (cause: unknown) {
        console.error("Native runtime request failed:", cause);
        if (active) setError(errorMessage(cause));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The clock: every second.
  useEffect(() => {
    let active = true;
    let reading = false;
    const readClock = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        if (!window.nativeClock) throw new Error(BRIDGE_UNAVAILABLE);
        const value = await window.nativeClock.read();
        if (active) {
          setSnapshot(value);
          setError(null);
        }
      } catch (cause: unknown) {
        console.error("Native clock request failed:", cause);
        if (active) setError(errorMessage(cause));
      } finally {
        reading = false;
      }
    };

    void readClock();
    const timer = window.setInterval(() => void readClock(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const connected = runtime !== null && snapshot !== null;
  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="wordmark">
          <span className="brand-icon">ct</span>node-ctypes<span className="wordmark-separator">/</span>Electron
        </div>
        <p className="tagline">Native calls in the main process &middot; a typed preload bridge &middot; a sandboxed React renderer</p>
        <span className={`status ${error ? "status-error" : connected ? "status-ready" : ""}`} role="status">
          <span className="status-dot" />
          {error ? "Native error" : connected ? "Native bridge connected" : "Connecting"}
        </span>
      </header>

      {runtime && (
        <dl className="runtime-strip" aria-label="Runtime">
          <div>
            <dt>node-ctypes</dt>
            <dd>{runtime.ctypesVersion}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{runtime.electronVersion}</dd>
          </div>
          <div>
            <dt>Node.js</dt>
            <dd>{runtime.nodeVersion}</dd>
          </div>
          <div>
            <dt>Chromium</dt>
            <dd>{runtime.chromeVersion}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>
              {runtime.platform} / {runtime.architecture}
            </dd>
          </div>
          <div title={`Native PID from ${runtime.pidApi}`}>
            <dt>Native / main PID</dt>
            <dd>
              {runtime.nativePid} / {runtime.mainPid}
            </dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>{runtime.isPackaged ? "Packaged app" : "Development"}</dd>
          </div>
        </dl>
      )}

      {error && (
        <section className="error-panel" role="alert">
          <h2>The native call failed</h2>
          <p>{error}</p>
          <p>No browser mock or fallback data is used.</p>
        </section>
      )}

      {snapshot && runtime && (
        <section className="readings-grid" aria-label="Native clock result">
          <ClockPanel snapshot={snapshot} />
          <article className="panel memory-panel">
            <div className="panel-heading">
              <span className="eyebrow">NATIVE MEMORY</span>
              <span className="tag">{snapshot.allocationBytes} bytes</span>
            </div>
            <h2>{runtime.externalBuffers ? "External buffers" : "Synchronized mirrors"}</h2>
            <p>A view is created before C writes the time. Its fields are then read back from the same native allocation.</p>
            <div className="memory-flow">
              <code>malloc</code>
              <span>&rarr;</span>
              <code>C clock</code>
              <span>&rarr;</span>
              <code>Structure</code>
              <span>&rarr;</span>
              <code>free</code>
            </div>
            <code className="memory-hex">{snapshot.rawHex}</code>
            <p className="small-note">
              External buffers: <strong>{String(runtime.externalBuffers)}</strong>. The mode is detected automatically.
            </p>
          </article>
        </section>
      )}

      <section className="system-row" aria-label="Processor and memory">
        <CpuPanel />
        <SystemPanel />
      </section>

      <footer>FFI in the main process. No Node.js access in React. Every native allocation is released after the read.</footer>
    </main>
  );
}

export default App;
