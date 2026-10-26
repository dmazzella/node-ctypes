import { useEffect, useState } from "react";
import type { NativeClockSnapshot } from "../electron/native-clock-api";
import "./App.css";

function App() {
  const [snapshot, setSnapshot] = useState<NativeClockSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let reading = false;
    const readClock = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        if (!window.nativeClock) throw new Error("The native bridge is unavailable. Start this application in Electron, not a browser.");
        const value = await window.nativeClock.read();
        if (active) {
          setSnapshot(value);
          setError(null);
        }
      } catch (cause: unknown) {
        console.error("Native clock request failed:", cause);
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
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

  return (
    <main className="app-shell">
      <header className="masthead">
        <div className="wordmark">
          <span className="brand-icon">ct</span>node-ctypes<span className="wordmark-separator">/</span>Electron
        </div>
        <span className={`status ${error ? "status-error" : snapshot ? "status-ready" : ""}`} role="status">
          <span className="status-dot" />
          {error ? "Native error" : snapshot ? "Native bridge connected" : "Connecting"}
        </span>
      </header>

      <section className="intro">
        <p className="eyebrow">REAL NATIVE CALLS. ISOLATED RENDERER.</p>
        <h1>
          A native clock,
          <br />
          <span>inside React.</span>
        </h1>
        <p className="lede">Electron calls the operating system with node-ctypes. React receives a typed snapshot through a sandboxed preload bridge.</p>
        <p className="refresh-note">Updates automatically every second.</p>
      </section>

      {error && (
        <section className="error-panel" role="alert">
          <h2>The native call failed</h2>
          <p>{error}</p>
          <p>No browser mock or fallback data is used.</p>
        </section>
      )}

      {snapshot && (
        <>
          <section className="readings-grid" aria-label="Native clock result">
            <article className="panel clock-panel">
              <div className="panel-heading">
                <span className="eyebrow">OPERATING SYSTEM CLOCK</span>
                <span className="tag">UTC</span>
              </div>
              <time className="clock-value" dateTime={snapshot.isoTime}>
                {snapshot.isoTime.slice(11, 23)}
              </time>
              <p className="clock-date">{snapshot.isoTime.slice(0, 10)}</p>
              <div className="reading-detail">
                <span>Nanoseconds since Unix epoch</span>
                <code>{snapshot.epochNanoseconds}</code>
              </div>
              <code className="api-name">{snapshot.clockApi}</code>
            </article>
            <article className="panel memory-panel">
              <div className="panel-heading">
                <span className="eyebrow">NATIVE MEMORY</span>
                <span className="tag">{snapshot.allocationBytes} bytes</span>
              </div>
              <h2>{snapshot.externalBuffers ? "External buffers" : "Synchronized mirrors"}</h2>
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
                External buffers: <strong>{String(snapshot.externalBuffers)}</strong>. The mode is detected automatically.
              </p>
            </article>
          </section>

          <section className="panel runtime-panel" aria-labelledby="runtime-heading">
            <div className="panel-heading">
              <h2 id="runtime-heading">Runtime verification</h2>
              <span className="tag">{snapshot.isPackaged ? "Packaged app" : "Development"}</span>
            </div>
            <dl className="runtime-grid">
              <div>
                <dt>node-ctypes</dt>
                <dd>{snapshot.ctypesVersion}</dd>
              </div>
              <div>
                <dt>Electron</dt>
                <dd>{snapshot.electronVersion}</dd>
              </div>
              <div>
                <dt>Node.js</dt>
                <dd>{snapshot.nodeVersion}</dd>
              </div>
              <div>
                <dt>Chromium</dt>
                <dd>{snapshot.chromeVersion}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>
                  {snapshot.platform} / {snapshot.architecture}
                </dd>
              </div>
              <div>
                <dt>Native / main PID</dt>
                <dd>
                  {snapshot.nativePid} / {snapshot.mainPid}
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
      <footer>FFI in the main process. No Node.js access in React. Every native allocation is released after the read.</footer>
    </main>
  );
}

export default App;
