import Constants from "expo-constants";
import { Platform } from "react-native";

/** The installed build as "version (build)", the label a papercut records as its build. */
export function appBuildLabel(): string {
  const build =
    (Platform.OS === "ios"
      ? Constants.platform?.ios?.buildNumber
      : Constants.platform?.android?.versionCode?.toString()) ?? "dev";
  return `${Constants.expoConfig?.version ?? "0.0.0"} (${build})`;
}
