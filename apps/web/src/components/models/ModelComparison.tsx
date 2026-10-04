import type { ModelCatalog } from "@t3tools/contracts";
import {
  formatAbsoluteDate,
  formatBlendedPrice,
  formatContextWindow,
  formatMomentum,
  formatRank,
  formatRate,
  formatScore,
  formatThroughput,
  formatTtft,
  getMaker,
  getServingProvider,
  MODEL_CATALOG_METHODOLOGY,
} from "@t3tools/shared/modelCatalog";

import { ScrollArea } from "../ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { displayOrDash, EM_DASH, specializationText } from "./modelCatalogDisplay";
import type { ModelRow } from "./modelCatalogView";

function boolLabel(value: boolean | undefined): string {
  return value === undefined ? EM_DASH : value ? "Yes" : "No";
}

export function ModelComparison({
  catalog,
  rows,
  onOpenChange,
}: {
  catalog: ModelCatalog;
  rows: readonly ModelRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const dimensions: readonly {
    readonly label: string;
    readonly render: (row: ModelRow) => string;
  }[] = [
    { label: "Maker", render: (row) => row.makerName },
    {
      label: "Provider",
      render: (row) =>
        row.model.offers
          .map((offer) => getServingProvider(catalog, offer.servingProviderId)?.name ?? offer.label)
          .join(", "),
    },
    {
      label: "Released",
      render: (row) => displayOrDash(formatAbsoluteDate(row.releasedAt)),
    },
    {
      label: "Capability",
      render: (row) =>
        row.capabilityPublished && row.capability !== undefined
          ? (formatScore(row.capability) ?? EM_DASH)
          : (row.withheldReason ?? "Not measured"),
    },
    {
      label: "Specialization",
      render: (row) =>
        row.specializations.length === 0
          ? EM_DASH
          : row.specializations.map(specializationText).join(", "),
    },
    { label: "Blended $/M", render: (row) => displayOrDash(formatBlendedPrice(row.blendedPrice)) },
    {
      label: "Input",
      render: (row) => displayOrDash(formatRate(primaryRate(row, "input"))),
    },
    {
      label: "Output",
      render: (row) => displayOrDash(formatRate(primaryRate(row, "output"))),
    },
    {
      label: "Cache read",
      render: (row) => displayOrDash(formatRate(primaryRate(row, "cacheRead"))),
    },
    { label: "Median TTFT", render: (row) => displayOrDash(formatTtft(row.ttftSeconds)) },
    { label: "Generation", render: (row) => displayOrDash(formatThroughput(row.throughput)) },
    {
      label: "Context",
      render: (row) => displayOrDash(formatContextWindow(row.contextWindow)),
    },
    {
      label: "Max output",
      render: (row) => displayOrDash(formatContextWindow(row.model.technical.maxOutputTokens)),
    },
    {
      label: "Modalities",
      render: (row) =>
        row.model.technical.modalities.length === 0
          ? EM_DASH
          : row.model.technical.modalities.join(", "),
    },
    { label: "Tools", render: (row) => boolLabel(row.model.technical.supportsTools) },
    {
      label: "Structured output",
      render: (row) => boolLabel(row.model.technical.supportsStructuredOutput),
    },
    {
      label: "Reasoning control",
      render: (row) => boolLabel(row.model.technical.supportsReasoningControl),
    },
    { label: "Open weights", render: (row) => boolLabel(row.model.technical.openWeights) },
    {
      label: "Usage rank",
      render: (row) => displayOrDash(formatRank(row.usageRank)),
    },
    {
      label: "7d momentum",
      render: (row) => displayOrDash(formatMomentum(row.momentum7d)),
    },
  ];

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>Compare models</SheetTitle>
          <SheetDescription>
            Transparent dimensions only; no combined value score is calculated. Blended price uses{" "}
            {MODEL_CATALOG_METHODOLOGY.blendMethodologyVersion}.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-6 pb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 text-left text-xs font-normal text-muted-foreground">
                    Dimension
                  </th>
                  {rows.map((row) => (
                    <th
                      key={row.model.id}
                      className="py-2 pr-4 text-left text-xs font-medium text-foreground"
                    >
                      {row.model.canonicalName}
                      <span className="block font-normal text-muted-foreground">
                        {getMaker(catalog, row.model.makerId)?.name ?? row.model.makerId}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dimensions.map((dimension) => (
                  <tr key={dimension.label} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-muted-foreground">{dimension.label}</td>
                    {rows.map((row) => (
                      <td key={row.model.id} className="py-2 pr-4 text-foreground">
                        {dimension.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function primaryRate(row: ModelRow, field: "input" | "output" | "cacheRead"): number | undefined {
  const offer =
    row.model.offers.find((entry) => entry.id === row.model.primaryOfferId) ??
    row.model.offers.find((entry) => entry.isCanonical) ??
    row.model.offers[0];
  return offer?.rateCard?.[field];
}
