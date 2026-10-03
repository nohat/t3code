// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/**
 * The fork design-system bridge. It reads the vendored Ledger token source and
 * renders one scoped CSS file that maps Ledger tokens onto T3's semantic
 * variables under `[data-design="warm-brutalism"]`.
 *
 * Parity rule: nothing here changes the default appearance. With no
 * `data-design` attribute the app renders exactly as upstream; the bridge only
 * applies inside the opt-in profile. See docs/fork/design-system.md.
 */

export const REPO_ROOT = NodeURL.fileURLToPath(new NodeURL.URL("../../../", import.meta.url));
export const TOKENS_PATH = NodePath.join(REPO_ROOT, "design/tokens.json");
export const GENERATED_CSS_PATH = NodePath.join(
  REPO_ROOT,
  "apps/web/src/styles/warm-brutalism.generated.css",
);
export const THEME_DIR = NodePath.join(REPO_ROOT, "design/themes");
export const THEME_IDS = ["ledger-light", "ledger-dark"] as const;

export interface TokenValue {
  readonly $value: string;
  readonly $description?: string;
}

export interface LedgerTokens {
  readonly version: string;
  readonly color: {
    readonly light: Readonly<Record<string, TokenValue>>;
    readonly dark: Readonly<Record<string, TokenValue>>;
  };
  readonly type: {
    readonly family: Readonly<Record<"display" | "ui" | "mono", string>>;
    readonly scale: Readonly<
      Record<string, { readonly size: number; readonly line: number; readonly family: string }>
    >;
  };
  readonly space: Readonly<Record<string, number>>;
  readonly radius: Readonly<Record<string, number>>;
  readonly border: Readonly<Record<string, number>>;
  readonly density: Readonly<
    Record<string, { readonly row: number; readonly control: number; readonly pad: number }>
  >;
  readonly motion: {
    readonly duration: Readonly<Record<string, number>>;
    readonly ease: Readonly<Record<string, string>>;
    readonly ceiling: number;
  };
}

export function readTokens(path: string = TOKENS_PATH): LedgerTokens {
  return JSON.parse(NodeFS.readFileSync(path, "utf8")) as LedgerTokens;
}

export function readThemeFiles(): ReadonlyArray<{ id: string; json: string }> {
  return THEME_IDS.map((id) => ({
    id,
    json: NodeFS.readFileSync(NodePath.join(THEME_DIR, `${id}.json`), "utf8"),
  }));
}

/** `surface.page` -> `--wb-surface-page`. */
export function wbVar(key: string): string {
  return `--wb-${key.replace(/\./g, "-")}`;
}

/**
 * T3 semantic variable -> Ledger token key or literal. Only color roles and the
 * shape/type hooks are bridged; density, type scale and motion are emitted as
 * `--wb-*` tokens but not yet consumed by upstream components (see the ADR).
 */
const T3_COLOR_BRIDGE: ReadonlyArray<readonly [string, string]> = [
  ["--background", "surface.page"],
  ["--app-chrome-background", "surface.page"],
  ["--foreground", "ink.primary"],
  ["--card", "surface.panel"],
  ["--card-foreground", "ink.primary"],
  ["--popover", "surface.panel"],
  ["--popover-foreground", "ink.primary"],
  ["--surface-raised", "surface.raised"],
  ["--secondary", "surface.raised"],
  ["--secondary-foreground", "ink.primary"],
  ["--muted", "surface.raised"],
  ["--muted-foreground", "ink.secondary"],
  ["--placeholder", "ink.tertiary"],
  ["--secondary-label", "ink.tertiary"],
  ["--icon-muted", "ink.tertiary"],
  ["--accent", "surface.raised"],
  ["--accent-foreground", "ink.primary"],
  ["--primary", "action.fill"],
  ["--primary-foreground", "action.on"],
  ["--ring", "action.fill"],
  ["--border", "line.hairline"],
  ["--input", "line.strong"],
  ["--error", "bad.text"],
  ["--error-foreground", "bad.text"],
  ["--error-surface", "bad.surface"],
  ["--destructive", "bad.text"],
  ["--destructive-foreground", "bad.text"],
  ["--success", "ok.text"],
  ["--success-foreground", "ok.text"],
  ["--warning", "attn.fill"],
  ["--warning-foreground", "attn.text"],
  ["--warning-surface", "attn.surface"],
  ["--info", "action.fill"],
  ["--info-foreground", "action.fill"],
  ["--sidebar", "surface.panel"],
  ["--sidebar-foreground", "ink.primary"],
  ["--sidebar-muted-foreground", "ink.secondary"],
  ["--sidebar-control-surface", "surface.raised"],
  ["--sidebar-row-hover", "surface.raised"],
  ["--sidebar-row-active", "surface.inset"],
  ["--sidebar-row-selected", "surface.inset"],
  ["--sidebar-border", "line.hairline"],
  ["--code-background", "surface.inset"],
  ["--code-foreground", "ink.primary"],
  ["--terminal-background", "surface.inset"],
  ["--terminal-foreground", "ink.primary"],
];

const LITERAL_BRIDGE: ReadonlyArray<readonly [string, string]> = [
  ["--radius", "0.25rem"],
  ["--control-radius", "0.25rem"],
  ["--font-sans", "var(--wb-font-ui)"],
  ["--font-mono", "var(--wb-font-mono)"],
  ["--row", "var(--wb-density-work-row)"],
  ["--control", "var(--wb-density-work-control)"],
  ["--pad", "var(--wb-density-work-pad)"],
];

function colorBlock(tokens: readonly (readonly [string, TokenValue])[]): string {
  return tokens
    .map(([key, token]) => `  ${wbVar(key)}: ${token.$value};`)
    .sort()
    .join("\n");
}

function metaBlock(tokens: LedgerTokens): string {
  const lines: string[] = [];
  for (const [name, family] of Object.entries(tokens.type.family)) {
    lines.push(`  --wb-font-${name}: ${family};`);
  }
  for (const [name, value] of Object.entries(tokens.type.scale)) {
    lines.push(`  --wb-fs-${name}: ${value.size}px;`);
    lines.push(`  --wb-lh-${name}: ${value.line}px;`);
  }
  lines.push(`  --wb-measure: 68ch;`);
  for (const [name, value] of Object.entries(tokens.space)) {
    lines.push(`  --wb-space-${name}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(tokens.radius)) {
    lines.push(`  --wb-radius-${name}: ${value}px;`);
  }
  for (const [name, value] of Object.entries(tokens.border)) {
    lines.push(`  --wb-border-${name}: ${value}px;`);
  }
  for (const [tier, value] of Object.entries(tokens.density)) {
    lines.push(`  --wb-density-${tier}-row: ${value.row}px;`);
    lines.push(`  --wb-density-${tier}-control: ${value.control}px;`);
    lines.push(`  --wb-density-${tier}-pad: ${value.pad}px;`);
  }
  for (const [name, value] of Object.entries(tokens.motion.duration)) {
    lines.push(`  --wb-motion-${name}: ${value}ms;`);
  }
  for (const [name, value] of Object.entries(tokens.motion.ease)) {
    lines.push(`  --wb-ease-${name}: ${value};`);
  }
  return lines.sort().join("\n");
}

export function renderWarmBrutalismCss(tokens: LedgerTokens = readTokens()): string {
  const light = colorBlock(Object.entries(tokens.color.light));
  const dark = colorBlock(Object.entries(tokens.color.dark));
  const meta = metaBlock(tokens);
  const bridge = [
    ...T3_COLOR_BRIDGE.map(([variable, key]) => `  ${variable}: var(${wbVar(key)});`),
    ...LITERAL_BRIDGE.map(([variable, value]) => `  ${variable}: ${value};`),
  ].join("\n");

  return `/* GENERATED by scripts/fork/design-system/build.ts from design/tokens.json. Do not edit. */

/* Ledger raw tokens. Inert until the profile bridge consumes them. Light is
   the default; T3 marks dark with .dark on <html>. */
:root {
${light}
${meta}
}

.dark {
${dark}
}

/* The opt-in profile. With no [data-design="warm-brutalism"] ancestor the app
   renders exactly as upstream. */
[data-design="warm-brutalism"] {
${bridge}
}

[data-design="warm-brutalism"][data-density="glance"] {
  --row: var(--wb-density-glance-row);
  --control: var(--wb-density-glance-control);
  --pad: var(--wb-density-glance-pad);
}

[data-design="warm-brutalism"][data-density="focus"] {
  --row: var(--wb-density-focus-row);
  --control: var(--wb-density-focus-control);
  --pad: var(--wb-density-focus-pad);
}

@media (prefers-reduced-motion: reduce) {
  [data-design="warm-brutalism"] {
    --wb-motion-fast: 0ms;
    --wb-motion-base: 0ms;
    --wb-motion-enter: 0ms;
    --wb-motion-camera: 0ms;
  }
}
`;
}

// --- OKLCH -> sRGB -> WCAG contrast -----------------------------------------

export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

export function parseOklch(value: string): Oklch {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (!match) {
    throw new Error(`not an oklch() value: ${value}`);
  }
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** Linear-light sRGB components (0..1), before gamma encoding. */
export function oklchToLinearRgb({ l, c, h }: Oklch): { r: number; g: number; b: number } {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = lp * lp * lp;
  const m3 = mp * mp * mp;
  const s3 = sp * sp * sp;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

export function relativeLuminance(value: string): number {
  const { r, g, b } = oklchToLinearRgb(parseOklch(value));
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastPair {
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
}

export const REQUIRED_CONTRAST_PAIRS: ReadonlyArray<ContrastPair> = [
  { fg: "ink.primary", bg: "surface.page", min: 4.5 },
  { fg: "ink.primary", bg: "surface.panel", min: 4.5 },
  { fg: "ink.secondary", bg: "surface.page", min: 4.5 },
  { fg: "ink.tertiary", bg: "surface.panel", min: 4.5 },
  { fg: "action.on", bg: "action.fill", min: 4.5 },
  { fg: "attn.text", bg: "attn.surface", min: 4.5 },
  { fg: "ok.text", bg: "ok.surface", min: 4.5 },
  { fg: "bad.text", bg: "bad.surface", min: 4.5 },
  { fg: "ai.text", bg: "ai.surface", min: 4.5 },
  { fg: "line.strong", bg: "surface.page", min: 3 },
  { fg: "attn.stroke", bg: "surface.panel", min: 3 },
];

export function checkTokens(tokens: LedgerTokens): string[] {
  const failures: string[] = [];
  for (const mode of ["light", "dark"] as const) {
    const palette = tokens.color[mode];
    for (const pair of REQUIRED_CONTRAST_PAIRS) {
      const fg = palette[pair.fg];
      const bg = palette[pair.bg];
      if (!fg || !bg) {
        failures.push(`${mode}: missing token for ${pair.fg} or ${pair.bg}`);
        continue;
      }
      const ratio = contrastRatio(fg.$value, bg.$value);
      if (ratio + 1e-6 < pair.min) {
        failures.push(
          `${mode}: ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
        );
      }
    }
  }
  return failures;
}
