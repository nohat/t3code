import { useEffect, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import "~/styles/warm-brutalism.generated.css";

/**
 * Dev-only visual gallery for the fork design system. Parity is the default:
 * with the profile set to "upstream" this renders exactly as upstream, and
 * "warm brutalism" only changes anything once `data-design` is applied.
 *
 * Scope today: color roles, the T3 bridge, type scale, density, and every
 * `components/ui` variant. The status/provenance primitives are previews; they
 * become real `components/ui` variants in a follow-up (see docs/fork/design-system.md).
 */

type Profile = "upstream" | "warm-brutalism";
type Appearance = "light" | "dark";
type Density = "glance" | "work" | "focus";

interface Swatch {
  readonly label: string;
  readonly variable: string;
}

const LEDGER_COLORS: ReadonlyArray<{ group: string; swatches: ReadonlyArray<Swatch> }> = [
  {
    group: "Surface",
    swatches: [
      { label: "page", variable: "--wb-surface-page" },
      { label: "panel", variable: "--wb-surface-panel" },
      { label: "raised", variable: "--wb-surface-raised" },
      { label: "inset", variable: "--wb-surface-inset" },
    ],
  },
  {
    group: "Ink / line",
    swatches: [
      { label: "ink.primary", variable: "--wb-ink-primary" },
      { label: "ink.secondary", variable: "--wb-ink-secondary" },
      { label: "ink.tertiary", variable: "--wb-ink-tertiary" },
      { label: "line.strong", variable: "--wb-line-strong" },
      { label: "line.hairline", variable: "--wb-line-hairline" },
    ],
  },
  {
    group: "Semantic",
    swatches: [
      { label: "action.fill", variable: "--wb-action-fill" },
      { label: "action.surface", variable: "--wb-action-surface" },
      { label: "attn.fill", variable: "--wb-attn-fill" },
      { label: "attn.text", variable: "--wb-attn-text" },
      { label: "attn.surface", variable: "--wb-attn-surface" },
      { label: "ok.text", variable: "--wb-ok-text" },
      { label: "bad.text", variable: "--wb-bad-text" },
      { label: "ai.text", variable: "--wb-ai-text" },
    ],
  },
];

const T3_BRIDGE_PREVIEW: ReadonlyArray<Swatch> = [
  { label: "--background", variable: "--background" },
  { label: "--card", variable: "--card" },
  { label: "--foreground", variable: "--foreground" },
  { label: "--muted-foreground", variable: "--muted-foreground" },
  { label: "--primary", variable: "--primary" },
  { label: "--border", variable: "--border" },
  { label: "--sidebar", variable: "--sidebar" },
  { label: "--warning", variable: "--warning" },
  { label: "--error", variable: "--error" },
];

const TYPE_SCALE = ["meta", "label", "body", "pane", "section", "page"] as const;

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg", "icon-sm"] as const;
const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "success",
  "warning",
  "error",
  "info",
] as const;
const ALERT_VARIANTS = ["default", "success", "warning", "error", "info"] as const;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="border-b border-border py-8">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SwatchCell({ swatch }: { swatch: Swatch }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="size-6 shrink-0 rounded-sm border border-border"
        style={{ backgroundColor: `var(${swatch.variable})` }}
      />
      <span className="truncate font-mono text-2xs text-muted-foreground">{swatch.label}</span>
    </div>
  );
}

function StatusGlyph({
  word,
  shape,
  variable,
}: {
  word: string;
  shape: "circle" | "ring" | "diamond" | "square" | "open";
  variable: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-foreground">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 shrink-0"
        style={{
          backgroundColor:
            shape === "open" || shape === "ring" ? "transparent" : `var(${variable})`,
          border: shape === "open" || shape === "ring" ? `1.5px solid var(${variable})` : undefined,
          borderRadius: shape === "circle" ? "9999px" : shape === "diamond" ? "2px" : "1px",
          transform: shape === "diamond" ? "rotate(45deg)" : undefined,
        }}
      />
      <span>{word}</span>
    </span>
  );
}

export function StylebookPage() {
  const [profile, setProfile] = useState<Profile>("upstream");
  const [appearance, setAppearance] = useState<Appearance>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  const [density, setDensity] = useState<Density>("work");

  useEffect(() => {
    const root = document.documentElement;
    const previousDesign = root.dataset.design;
    const previousDensity = root.dataset.density;
    const previousDark = root.classList.contains("dark");
    return () => {
      if (previousDesign === undefined) delete root.dataset.design;
      else root.dataset.design = previousDesign;
      if (previousDensity === undefined) delete root.dataset.density;
      else root.dataset.density = previousDensity;
      root.classList.toggle("dark", previousDark);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (profile === "warm-brutalism") {
      root.dataset.design = "warm-brutalism";
      root.dataset.density = density;
    } else {
      delete root.dataset.design;
      delete root.dataset.density;
    }
  }, [profile, density]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", appearance === "dark");
  }, [appearance]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 pb-24">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 py-4 backdrop-blur">
          <h1 className="text-lg font-semibold">Fork design system stylebook</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Dev-only. Default profile is upstream; warm brutalism is an opt-in profile. Nothing here
            changes the shipped default appearance.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant={profile === "upstream" ? "default" : "outline"}
              size="sm"
              onClick={() => setProfile("upstream")}
            >
              Upstream
            </Button>
            <Button
              variant={profile === "warm-brutalism" ? "default" : "outline"}
              size="sm"
              onClick={() => setProfile("warm-brutalism")}
            >
              Warm brutalism
            </Button>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <Button
              variant={appearance === "light" ? "default" : "outline"}
              size="sm"
              onClick={() => setAppearance("light")}
            >
              Light
            </Button>
            <Button
              variant={appearance === "dark" ? "default" : "outline"}
              size="sm"
              onClick={() => setAppearance("dark")}
            >
              Dark
            </Button>
            <Separator orientation="vertical" className="mx-1 h-6" />
            {(["glance", "work", "focus"] as const).map((tier) => (
              <Button
                key={tier}
                variant={density === tier ? "default" : "outline"}
                size="sm"
                disabled={profile !== "warm-brutalism"}
                onClick={() => setDensity(tier)}
              >
                {tier}
              </Button>
            ))}
          </div>
        </header>

        <Section
          title="Ledger raw tokens"
          note="The vendored token source, shown as --wb-* custom properties. These are inert until the profile bridge consumes them."
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {LEDGER_COLORS.map((group) => (
              <div key={group.group}>
                <div className="mb-2 text-xs font-medium text-foreground">{group.group}</div>
                <div className="flex flex-col gap-2">
                  {group.swatches.map((swatch) => (
                    <SwatchCell key={swatch.variable} swatch={swatch} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="T3 bridge"
          note="T3 semantic variables after the active profile. Switch profile above to compare upstream against warm brutalism."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {T3_BRIDGE_PREVIEW.map((swatch) => (
              <div key={swatch.variable} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-6 shrink-0 rounded-sm border border-border"
                  style={{ backgroundColor: `var(${swatch.variable})` }}
                />
                <span className="truncate font-mono text-2xs text-muted-foreground">
                  {swatch.label}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type scale" note="Ledger scale from --wb-fs-*; six sizes, three families.">
          <div className="flex flex-col gap-3">
            {TYPE_SCALE.map((size) => (
              <div key={size} className="flex items-baseline gap-4">
                <span className="w-16 font-mono text-2xs text-muted-foreground">{size}</span>
                <span
                  className="text-foreground"
                  style={{ fontSize: `var(--wb-fs-${size})`, lineHeight: `var(--wb-lh-${size})` }}
                >
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Density"
          note="Ledger row heights. Applies when the warm-brutalism profile is active."
        >
          <div className="flex flex-col gap-2">
            {(["glance", "work", "focus"] as const).map((tier) => (
              <div
                key={tier}
                className="flex items-center rounded-sm border border-border bg-card px-3 text-xs text-card-foreground"
                style={{ minHeight: `var(--wb-density-${tier}-row)` }}
              >
                {tier} row
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            {BUTTON_VARIANTS.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {BUTTON_SIZES.map((size) => (
              <Button key={size} size={size}>
                {size}
              </Button>
            ))}
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-2">
            {BADGE_VARIANTS.map((variant) => (
              <Badge key={variant} variant={variant}>
                {variant}
              </Badge>
            ))}
          </div>
        </Section>

        <Section title="Alerts">
          <div className="flex flex-col gap-3">
            {ALERT_VARIANTS.map((variant) => (
              <Alert key={variant} variant={variant}>
                <AlertTitle>{variant} alert</AlertTitle>
                <AlertDescription>Every figure carries its source and its age.</AlertDescription>
              </Alert>
            ))}
          </div>
        </Section>

        <Section title="Fields">
          <div className="flex max-w-md flex-col gap-3">
            <Input placeholder="Default input" />
            <Input font="mono" placeholder="Mono input, e.g. 4f2a1c9" />
          </div>
        </Section>

        <Section
          title="Status and provenance (preview)"
          note="Proposed primitives: word + shape + color, never color alone. Not yet extracted to components/ui."
        >
          <div className="flex flex-wrap items-center gap-6">
            <StatusGlyph word="ok" shape="circle" variable="--wb-ok-text" />
            <StatusGlyph word="running" shape="ring" variable="--wb-action-fill" />
            <StatusGlyph word="decision" shape="diamond" variable="--wb-attn-stroke" />
            <StatusGlyph word="critical" shape="square" variable="--wb-bad-text" />
            <StatusGlyph word="muted" shape="open" variable="--wb-ink-tertiary" />
            <StatusGlyph word="ai" shape="diamond" variable="--wb-ai-text" />
          </div>
        </Section>
      </div>
    </div>
  );
}
