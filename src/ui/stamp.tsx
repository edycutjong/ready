import type { ComponentChildren } from "preact";

/** The ink stamp (crypt-galley signature): IT LIVES only for a computed RESURRECTED state; never decorative. */
export type StampKind = "lives" | "stirs" | "dead" | "refusal";
export const STAMP_TEXT: Record<StampKind, string> = { lives: "IT LIVES", stirs: "IT STIRS", dead: "STILL DEAD", refusal: "REFUSED" };

export function stampFor(verdict: string | null | undefined): StampKind | null {
  if (!verdict) return null;
  const v = verdict.toUpperCase().replace(/[^A-Z]/g, "");
  if (v === "RESURRECTED") return "lives";
  if (v === "BOOTEDPARTIAL") return "stirs";
  if (v === "NOTRESURRECTED") return "dead";
  return null;
}

export function Stamp({ kind, small, children }: { kind: StampKind; small?: boolean; children?: ComponentChildren }) {
  return <span class={`stamp ${kind}${small ? " small" : ""}`} data-testid={`stamp-${kind}`} role="img" aria-label={STAMP_TEXT[kind]}>{children ?? STAMP_TEXT[kind]}</span>;
}
