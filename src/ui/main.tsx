import { render } from "preact";

/** Day-1 shell. The desk (scan · listing · C64 · certificate) lands on build day 3; nothing here is a placeholder claim. */
function App() {
  return (
    <main style={{ fontFamily: "ui-monospace, Menlo, monospace", background: "#0b0a09", color: "#e8e2d4", minHeight: "100vh", padding: "10vh 8vw" }}>
      <p style={{ color: "#c2271d", letterSpacing: "0.2em" }}>?SYNTAX  ERROR IN 20</p>
      <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)", margin: "0.3em 0" }}>Resurrecting 1984 type-in programs.</h1>
      <p style={{ maxWidth: "60ch", lineHeight: 1.6 }}>
        OCR reads the page, the magazine's own checksum flags every misread line, a real Commodore 64 runs it, and a
        Kiro agent repairs lines only through a deterministic gate. Build in progress for Kiroween 2026.
      </p>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
