import { DEFAULT_MODEL_COST_DISPLAY, type ModelCostDisplay } from "@t3tools/contracts/settings";
import { PricingBadge } from "../chat/PricingBadge";
import type { ModelPricing } from "../chat/providerIconUtils";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const DISPLAY_OPTIONS: ReadonlyArray<{ value: ModelCostDisplay; label: string }> = [
  { value: "input-output", label: "Input/output + cache discount" },
  { value: "blended", label: "Blended rate" },
  { value: "both", label: "Both" },
];

const PREVIEW_PRICING: ModelPricing = {
  inputCostPerMillionTokens: 3,
  outputCostPerMillionTokens: 15,
  cacheReadCostPerMillionTokens: 0.3,
  cacheWriteCostPerMillionTokens: 3.75,
  costSource: "modelPriced",
};

export function ModelCostDisplaySettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const setting = searchableSetting("model-cost-display");

  return (
    <SettingsRow
      {...setting}
      description="Choose how model rates appear in the composer model picker."
      resetAction={
        settings.modelCostDisplay !== DEFAULT_MODEL_COST_DISPLAY ? (
          <SettingResetButton
            label="model cost display"
            onClick={() => updateSettings({ modelCostDisplay: DEFAULT_MODEL_COST_DISPLAY })}
          />
        ) : null
      }
      control={
        <div className="w-full sm:w-56">
          <Select
            value={settings.modelCostDisplay}
            onValueChange={(value) => {
              if (value === "input-output" || value === "blended" || value === "both") {
                updateSettings({ modelCostDisplay: value });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Model cost display">
              <SelectValue>
                {
                  DISPLAY_OPTIONS.find((option) => option.value === settings.modelCostDisplay)
                    ?.label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {DISPLAY_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      }
    >
      <div className="mb-3 mt-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Example model</div>
          <div className="text-2xs text-muted-foreground">Per 1M tokens</div>
        </div>
        <PricingBadge pricing={PREVIEW_PRICING} display={settings.modelCostDisplay} />
      </div>
    </SettingsRow>
  );
}
