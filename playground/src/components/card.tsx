import type { CSSProperties, ReactElement, ReactNode } from "react";

// Minimal slotted components, hand-rolled for the playground. The overlay only
// needs `data-slot` attributes to discover a tree, so these are plain divs with
// enough styling to render at real sizes and rounded corners — that is all the
// placement engine reads. No design system, no base-ui: the point is to show the
// overlay working over an arbitrary component, and the smallest such component
// makes the example easiest to follow.

const surface = "#eef2f7";
const elevated = "#dfe6ef";
const ink = "#1f2933";
const muted = "#5b6b7b";

function slot(
  name: string,
  style: CSSProperties,
  children: ReactNode,
): ReactElement {
  return (
    <div data-slot={name} style={style}>
      {children}
    </div>
  );
}

export function Card({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: 360,
        padding: 16,
        borderRadius: 12,
        background: "#fff",
        border: `1px solid ${elevated}`,
        color: ink,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

export function Media({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "media",
    { height: 80, borderRadius: 8, background: elevated, overflow: "hidden" },
    children,
  );
}

export function Heading({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "heading",
    { display: "flex", alignItems: "center", gap: 10 },
    children,
  );
}

export function Icon({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "icon",
    {
      display: "grid",
      placeItems: "center",
      width: 28,
      height: 28,
      borderRadius: 6,
      background: surface,
      color: muted,
      flex: "0 0 auto",
    },
    children,
  );
}

export function Title({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "title",
    { display: "flex", flexDirection: "column", gap: 2, flex: "1 1 auto" },
    children,
  );
}

export function Text({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "text",
    { fontSize: 14, fontWeight: 600, lineHeight: 1.3 },
    children,
  );
}

export function Subtitle({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "subtitle",
    { fontSize: 12, color: muted, lineHeight: 1.3 },
    children,
  );
}

export function Attribute({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return slot(
    "attribute",
    {
      display: "flex",
      flexDirection: "column",
      gap: 1,
      padding: "2px 8px",
      borderRadius: 6,
      background: surface,
      flex: "0 0 auto",
    },
    <>
      <span style={{ fontSize: 9, color: muted, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{children}</span>
    </>,
  );
}

export function Badge({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "badge",
    {
      padding: "2px 8px",
      // A finite radius on purpose: `getComputedStyle` reports the *specified*
      // border-radius, not the clamped used value, so a `999px` pill would tell
      // the engine every corner is 999px and `insetFor` would swallow the whole
      // edge, leaving the slot with no anchor anywhere (hard rule 9).
      borderRadius: 10,
      background: "#d5f2e0",
      color: "#137a4b",
      fontSize: 11,
      fontWeight: 600,
      flex: "0 0 auto",
    },
    children,
  );
}

export function Actions({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "actions",
    {
      display: "grid",
      placeItems: "center",
      width: 24,
      height: 24,
      borderRadius: 6,
      background: surface,
      color: muted,
      flex: "0 0 auto",
    },
    children ?? "⋯",
  );
}

export function Body({ children }: { children: ReactNode }): ReactElement {
  return slot("body", {}, children);
}

export function Footer({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "footer",
    { display: "flex", alignItems: "center", gap: 10 },
    children,
  );
}

export function ButtonPrimary({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return slot(
    "button-primary",
    {
      padding: "6px 14px",
      borderRadius: 8,
      background: "#2f6feb",
      color: "#fff",
      fontSize: 13,
      fontWeight: 600,
      flex: "0 0 auto",
    },
    children,
  );
}

export function Meta({ children }: { children: ReactNode }): ReactElement {
  return slot(
    "meta",
    {
      display: "flex",
      alignItems: "center",
      gap: 4,
      fontSize: 12,
      color: muted,
    },
    children,
  );
}

export function ChartPlaceholder(): ReactElement {
  return <div style={{ height: 96, borderRadius: 8, background: elevated }} />;
}
