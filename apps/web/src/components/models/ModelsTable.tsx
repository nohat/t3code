import type { SortKey, ModelRow, SortSpec } from "./modelCatalogView";
import {
  formatBlendedPrice,
  formatContextWindow,
  formatMomentum,
  formatMonthYear,
  formatRank,
  formatScore,
  formatThroughput,
} from "@t3tools/shared/modelCatalog";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { capabilityLabel, displayOrDash, EM_DASH, specializationText } from "./modelCatalogDisplay";

interface Column {
  readonly id: string;
  readonly label: string;
  readonly sortKey?: SortKey;
  readonly numeric?: boolean;
}

const COLUMNS: readonly Column[] = [
  { id: "name", label: "Model", sortKey: "name" },
  { id: "released", label: "Released", sortKey: "released" },
  { id: "capability", label: "Capability", sortKey: "capability", numeric: true },
  { id: "profile", label: "Profile" },
  { id: "price", label: "Blended $/M", sortKey: "price", numeric: true },
  { id: "throughput", label: "Speed", sortKey: "throughput", numeric: true },
  { id: "context", label: "Context", sortKey: "context", numeric: true },
  { id: "usage", label: "Usage", sortKey: "usage", numeric: true },
];

interface ModelsTableProps {
  readonly rows: readonly ModelRow[];
  readonly sort: SortSpec;
  readonly onSortChange: (key: SortKey) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelected: (id: string) => void;
  readonly onOpenDetail: (id: string) => void;
}

export function ModelsTable({
  rows,
  sort,
  onSortChange,
  selectedIds,
  onToggleSelected,
  onOpenDetail,
}: ModelsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          {COLUMNS.map((column) => {
            const sortKey = column.sortKey;
            return (
              <TableHead key={column.id} className={column.numeric ? "text-right" : undefined}>
                {sortKey === undefined ? (
                  <span className="text-xs font-medium text-muted-foreground">{column.label}</span>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
                      column.numeric && "flex-row-reverse",
                    )}
                    onClick={() => onSortChange(sortKey)}
                  >
                    {column.label}
                    {sort.key === sortKey ? (
                      sort.direction === "asc" ? (
                        <ArrowUpIcon className="size-3" />
                      ) : (
                        <ArrowDownIcon className="size-3" />
                      )
                    ) : null}
                  </button>
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLUMNS.length + 1}>
              <div className="py-8 text-center text-muted-foreground">
                No models match these filters.
              </div>
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.model.id}
              className="cursor-pointer"
              data-state={selectedIds.has(row.model.id) ? "selected" : undefined}
              onClick={() => onOpenDetail(row.model.id)}
            >
              <TableCell onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(row.model.id)}
                  onCheckedChange={() => onToggleSelected(row.model.id)}
                  aria-label={`Select ${row.model.canonicalName} for comparison`}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{row.model.canonicalName}</span>
                  {row.isNew ? (
                    <Badge size="sm" variant="info">
                      New
                    </Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground">{row.makerName}</div>
              </TableCell>
              <TableCell>
                <span className="text-muted-foreground">
                  {displayOrDash(formatMonthYear(row.releasedAt))}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {row.capabilityPublished && row.capability !== undefined ? (
                  <span className="font-medium text-foreground tabular-nums">
                    {formatScore(row.capability)}
                  </span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="text-muted-foreground">{EM_DASH}</span>}
                    />
                    <TooltipPopup>
                      {capabilityLabel(row.capabilityPublished, row.withheldReason)}
                    </TooltipPopup>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell>
                {row.specializations.length === 0 ? (
                  <span className="text-muted-foreground">{EM_DASH}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {row.specializations.map((specialization) => (
                      <Badge
                        key={specialization.family}
                        size="sm"
                        variant={specialization.residual > 0 ? "success" : "warning"}
                      >
                        {specializationText(specialization)}
                      </Badge>
                    ))}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <span className="tabular-nums">
                  {displayOrDash(formatBlendedPrice(row.blendedPrice))}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="tabular-nums">
                  {displayOrDash(formatThroughput(row.throughput))}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="tabular-nums">
                  {displayOrDash(formatContextWindow(row.contextWindow))}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {row.usageRank === undefined ? (
                  <span className="text-muted-foreground">{EM_DASH}</span>
                ) : (
                  <span className="flex flex-col items-end tabular-nums">
                    <span className="text-foreground">{formatRank(row.usageRank)}</span>
                    {row.momentum7d !== undefined ? (
                      <span className="text-muted-foreground text-xs">
                        {formatMomentum(row.momentum7d)} 7d
                      </span>
                    ) : null}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
