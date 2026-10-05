import type { ModelCostDisplay } from "@t3tools/contracts/settings";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

const OPTIONS = [
  { value: "input-output", label: "Input / output" },
  { value: "blended", label: "Blended" },
  { value: "both", label: "Both" },
] as const;

export function ModelPricingDisplayControl(props: {
  readonly value: ModelCostDisplay;
  readonly onChange: (value: ModelCostDisplay) => void;
}) {
  return (
    <View className="gap-2 px-4 py-3">
      <Text className="text-xs text-foreground-muted">
        API-equivalent prices in USD, not subscription charges.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={`Model prices: ${option.label}`}
            accessibilityState={{ checked: props.value === option.value }}
            onPress={() => props.onChange(option.value)}
            style={{ minHeight: 44 }}
            className={cn(
              "min-h-11 justify-center rounded-lg px-3 py-2 active:opacity-70",
              props.value === option.value ? "bg-subtle-strong" : "bg-card",
            )}
          >
            <Text className="text-sm text-foreground">
              {props.value === option.value ? "✓ " : ""}
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {props.value !== "input-output" ? (
        <Text className="text-xs text-foreground-muted">
          Blended input assumes 90% cache reads; excludes cache-write premiums.
        </Text>
      ) : null}
    </View>
  );
}
