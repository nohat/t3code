import { useMemo, useState } from "react";

import {
  BENCHMARK_FAMILY_ORDER,
  formatAge,
  listMakers,
  listServingProviders,
  MODEL_CATALOG,
  MODEL_CATALOG_METHODOLOGY,
} from "@t3tools/shared/modelCatalog";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { CapabilityPriceScatter } from "./CapabilityPriceScatter";
import { ModelComparison } from "./ModelComparison";
import { ModelDetail } from "./ModelDetail";
import { ModelFiltersBar } from "./ModelFilters";
import { ModelsTable } from "./ModelsTable";
import {
  buildModelRows,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterModelRows,
  sortModelRows,
  type ModelFilters,
  type SortKey,
  type SortSpec,
} from "./modelCatalogView";

const MAX_COMPARISON_MODELS = 6;

export function ModelsPage() {
  // Capture "now" once per mount; freshness and recency labels do not need to tick.
  const [nowMs] = useState(() => Date.now());
  const rows = useMemo(() => buildModelRows(MODEL_CATALOG, nowMs), [nowMs]);
  const makers = useMemo(() => listMakers(MODEL_CATALOG), []);
  const servingProviders = useMemo(() => listServingProviders(MODEL_CATALOG), []);
  const specializationFamilies = useMemo(() => {
    const present = new Set(
      MODEL_CATALOG.models.flatMap((model) =>
        model.capability.dimensions.map((dimension) => dimension.family),
      ),
    );
    return BENCHMARK_FAMILY_ORDER.filter((family) => present.has(family));
  }, []);

  const [filters, setFilters] = useState<ModelFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showScatter, setShowScatter] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  const filtered = useMemo(
    () => sortModelRows(filterModelRows(rows, filters, nowMs), sort),
    [rows, filters, sort, nowMs],
  );
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.model.id)),
    [rows, selectedIds],
  );

  const handleSortChange = (key: SortKey) => {
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "name" || key === "maker" ? "asc" : "desc" },
    );
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_COMPARISON_MODELS) next.add(id);
      return next;
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h1 className="text-sm font-medium">Models</h1>
              <span className="text-xs text-muted-foreground">
                Updated {formatAge(MODEL_CATALOG.generatedAt, nowMs)} ·{" "}
                {MODEL_CATALOG.models.length} models
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={showScatter ? "secondary" : "outline"}
                size="sm"
                onClick={() => setShowScatter((value) => !value)}
              >
                Capability × price
              </Button>
              <Button
                variant={showComparison ? "secondary" : "outline"}
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => setShowComparison(true)}
              >
                Compare ({selectedIds.size})
              </Button>
              {selectedIds.size > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded">
            <ModelFiltersBar
              filters={filters}
              makers={makers}
              servingProviders={servingProviders}
              specializationFamilies={specializationFamilies}
              onChange={setFilters}
            />
            {showScatter ? (
              <div className="rounded-lg border border-border/60 p-4">
                <CapabilityPriceScatter rows={filtered} selectedIds={selectedIds} />
              </div>
            ) : null}
            <div className="rounded-lg border border-border/60">
              <ModelsTable
                rows={filtered}
                sort={sort}
                onSortChange={handleSortChange}
                selectedIds={selectedIds}
                onToggleSelected={toggleSelected}
                onOpenDetail={setDetailId}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {rows.length} models. Capability is published only with
              general-reasoning and coding evidence plus at least{" "}
              {MODEL_CATALOG_METHODOLOGY.publication.minimumFamilies} benchmark families; missing
              data is never shown as zero. Blended price uses{" "}
              {MODEL_CATALOG_METHODOLOGY.blendMethodologyVersion}.
            </p>
          </WorkspacePageContainer>
        </ScrollArea>
      </div>

      <ModelDetail
        catalog={MODEL_CATALOG}
        modelId={detailId}
        nowMs={nowMs}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
      {showComparison ? (
        <ModelComparison
          catalog={MODEL_CATALOG}
          rows={selectedRows}
          onOpenChange={(open) => !open && setShowComparison(false)}
        />
      ) : null}
    </SidebarInset>
  );
}
