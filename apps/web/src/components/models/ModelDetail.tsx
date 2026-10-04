import type { CatalogGeneratedText, ModelCatalog, CatalogObservation } from "@t3tools/contracts";
import {
  formatAbsoluteDate,
  formatAge,
  formatBlendedPrice,
  formatContextWindow,
  formatMomentum,
  formatRank,
  formatRate,
  formatScore,
  formatThroughput,
  formatTtft,
  getBlendedPrice,
  getGeneratedText,
  getMaker,
  getServingProvider,
  MODEL_CATALOG_METHODOLOGY,
} from "@t3tools/shared/modelCatalog";

import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { displayOrDash, EM_DASH, familyLabel, specializationText } from "./modelCatalogDisplay";
import type { ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function Summary({
  entry,
  emptyLabel,
}: {
  entry: CatalogGeneratedText | undefined;
  emptyLabel: string;
}) {
  if (entry === undefined) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  if (entry.reviewStatus === "rejected") {
    return (
      <p className="text-sm text-muted-foreground">
        Summary unavailable: {entry.rejectedReason ?? "failed validation"}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-foreground">{entry.text}</p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {entry.reviewStatus === "pending" ? (
          <Badge size="sm" variant="warning">
            Pending review
          </Badge>
        ) : null}
        <span>{entry.promptVersion}</span>
        {entry.providerModelSelection.model ? (
          <span>· {entry.providerModelSelection.model}</span>
        ) : null}
      </div>
    </div>
  );
}

function sourceLabel(observation: CatalogObservation): string {
  return `${observation.metric} = ${String(observation.value)}`;
}

export function ModelDetail({
  catalog,
  modelId,
  nowMs,
  onOpenChange,
}: {
  catalog: ModelCatalog;
  modelId: string | null;
  nowMs: number;
  onOpenChange: (open: boolean) => void;
}) {
  const model = modelId === null ? undefined : catalog.models.find((entry) => entry.id === modelId);
  if (model === undefined) return null;

  const maker = getMaker(catalog, model.makerId);
  const primary =
    model.offers.find((offer) => offer.id === model.primaryOfferId) ?? model.offers[0];
  const blend = MODEL_CATALOG_METHODOLOGY.blend;
  const capability = model.capability;
  const providerIntent = getGeneratedText(catalog, model.description?.providerIntentId);
  const observedProfile = getGeneratedText(catalog, model.description?.observedProfileId);
  const evidence = catalog.observations.filter((observation) => observation.modelId === model.id);

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {model.canonicalName}
            {model.version !== undefined ? ` ${model.version}` : ""}
          </SheetTitle>
          <SheetDescription>
            {maker?.name ?? model.makerId} ·{" "}
            {model.releasedAt === undefined
              ? "release date unknown"
              : `Released ${formatAbsoluteDate(model.releasedAt)}`}
            {model.releasedAt === undefined ? "" : ` · ${formatAge(model.releasedAt, nowMs)}`}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 px-6 pb-8">
            <Section title="Summary">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Provider intent</p>
                  <Summary entry={providerIntent} emptyLabel="No provider summary generated." />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Observed profile</p>
                  <Summary entry={observedProfile} emptyLabel="No observed profile generated." />
                </div>
              </div>
            </Section>

            <Section title="Capability">
              {capability.published && capability.overall !== undefined ? (
                <>
                  <Field label="Overall">{formatScore(capability.overall.score)}</Field>
                  <Field label="Frontier reference">
                    {formatScore(capability.overall.frontierReference)}
                  </Field>
                  <Field label="Coverage">
                    {capability.overall.coverage.familiesCovered.length} /{" "}
                    {capability.overall.coverage.familiesCovered.length +
                      capability.overall.coverage.familiesRequired.length}{" "}
                    required families
                  </Field>
                  {capability.dimensions.map((dimension) => {
                    const specialization = capability.specializations.find(
                      (entry) => entry.family === dimension.family,
                    );
                    return (
                      <Field key={dimension.family} label={familyLabel(dimension.family)}>
                        {formatScore(dimension.score)}
                        {specialization === undefined
                          ? ""
                          : ` · ${specializationText(specialization)}`}
                      </Field>
                    );
                  })}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {capability.withheldReason ?? "Not measured"}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Methodology {MODEL_CATALOG_METHODOLOGY.capabilityMethodologyVersion} ·{" "}
                {MODEL_CATALOG_METHODOLOGY.specializationMethodologyVersion}
              </p>
            </Section>

            <Section title="Pricing">
              <Field label="Blended price">
                {displayOrDash(formatBlendedPrice(getBlendedPrice(model)))}
              </Field>
              <p className="text-xs text-muted-foreground">
                Reference mix: {Math.round(blend.cachedInput * 100)}% cached ·{" "}
                {Math.round(blend.input * 100)}% input · {Math.round(blend.output * 100)}% output ·{" "}
                {MODEL_CATALOG_METHODOLOGY.blendMethodologyVersion}
              </p>
              {model.offers.map((offer) => (
                <div key={offer.id} className="mt-2 rounded-lg border border-border/60 p-3">
                  <div className="mb-1 flex items-center gap-2 text-sm text-foreground">
                    {getServingProvider(catalog, offer.servingProviderId)?.name ?? offer.label}
                    {offer.isCanonical ? (
                      <Badge size="sm" variant="secondary">
                        Canonical
                      </Badge>
                    ) : null}
                  </div>
                  {offer.rateCard === undefined ? (
                    <p className="text-sm text-muted-foreground">No published rate card.</p>
                  ) : (
                    <>
                      <Field label="Input">{displayOrDash(formatRate(offer.rateCard.input))}</Field>
                      <Field label="Output">
                        {displayOrDash(formatRate(offer.rateCard.output))}
                      </Field>
                      <Field label="Cache read">
                        {displayOrDash(formatRate(offer.rateCard.cacheRead))}
                      </Field>
                      <Field label="Cache write">
                        {displayOrDash(formatRate(offer.rateCard.cacheWrite))}
                      </Field>
                    </>
                  )}
                </div>
              ))}
            </Section>

            <Section title="Performance">
              <Field label="Median TTFT">
                {displayOrDash(
                  primary?.performance?.ttftMs === undefined
                    ? undefined
                    : formatTtft(primary.performance.ttftMs.median / 1000),
                )}
              </Field>
              <Field label="Generation">
                {displayOrDash(
                  formatThroughput(primary?.performance?.outputTokensPerSecond?.median),
                )}
              </Field>
              {primary?.performance?.ttftMs === undefined &&
              primary?.performance?.outputTokensPerSecond === undefined ? (
                <p className="text-xs text-muted-foreground">
                  Not measured from a published source.
                </p>
              ) : null}
            </Section>

            <Section title="Adoption">
              {model.adoption === undefined || model.adoption.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No usage observations.</p>
              ) : (
                model.adoption.signals.map((signal) => (
                  <Field
                    key={`${signal.sourceId}-${signal.metric}-${signal.window}-${signal.task ?? ""}`}
                    label={`${signal.metric}${signal.task === undefined ? "" : ` (${signal.task})`} · ${signal.window}`}
                  >
                    {signal.metric === "usageRank" || signal.metric === "taskRank"
                      ? formatRank(signal.value)
                      : signal.metric === "momentum"
                        ? formatMomentum(signal.value)
                        : signal.value.toFixed(3)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {signal.platform}
                    </span>
                  </Field>
                ))
              )}
            </Section>

            <Section title="Technical">
              <Field label="Context">
                {displayOrDash(formatContextWindow(model.technical.contextWindow))}
              </Field>
              <Field label="Max output">
                {displayOrDash(formatContextWindow(model.technical.maxOutputTokens))}
              </Field>
              <Field label="Modalities">
                {model.technical.modalities.length === 0
                  ? EM_DASH
                  : model.technical.modalities.join(", ")}
              </Field>
              <Field label="Tools">
                {model.technical.supportsTools === undefined
                  ? EM_DASH
                  : model.technical.supportsTools
                    ? "Yes"
                    : "No"}
              </Field>
              <Field label="Structured output">
                {model.technical.supportsStructuredOutput === undefined
                  ? EM_DASH
                  : model.technical.supportsStructuredOutput
                    ? "Yes"
                    : "No"}
              </Field>
              <Field label="Reasoning control">
                {model.technical.supportsReasoningControl === undefined
                  ? EM_DASH
                  : model.technical.supportsReasoningControl
                    ? "Yes"
                    : "No"}
              </Field>
              <Field label="Open weights">
                {model.technical.openWeights === undefined
                  ? EM_DASH
                  : model.technical.openWeights
                    ? "Yes"
                    : "No"}
              </Field>
            </Section>

            <Section title="Sources">
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {[...new Set(evidence.map((observation) => observation.sourceId))].map(
                  (sourceId) => {
                    const source = catalog.sources.find((entry) => entry.sourceId === sourceId);
                    const observation = evidence.find((entry) => entry.sourceId === sourceId);
                    return (
                      <li key={sourceId} className="flex flex-col">
                        <span className="text-foreground">{source?.label ?? sourceId}</span>
                        {source?.url === undefined ? null : (
                          <a
                            className="truncate underline underline-offset-2"
                            href={source.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {source.url}
                          </a>
                        )}
                        {observation === undefined ? null : <span>{sourceLabel(observation)}</span>}
                      </li>
                    );
                  },
                )}
              </ul>
              <p className="text-xs text-muted-foreground">
                Catalog generated {formatAge(catalog.generatedAt, nowMs)} ·{" "}
                {catalog.observations.length} observations retained
              </p>
            </Section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
