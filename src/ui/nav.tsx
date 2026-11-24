export function Nav({ here }: { here: "raise" | "scan" | "kiro" }) {
  return (
    <nav class="nav" aria-label="main">
      <a href="/" aria-current={here === "raise" ? "page" : undefined}>Raise a listing</a>
      <a href="/scan" aria-current={here === "scan" ? "page" : undefined}>Check a page (assisted)</a>
      <a href="/kiro" aria-current={here === "kiro" ? "page" : undefined}>/kiro hooks</a>
    </nav>
  );
}
