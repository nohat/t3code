import {
  papercutEvents,
  papercutThreadContext,
  recordPapercutEvent,
} from "@t3tools/client-runtime/papercut";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";

import { parseActiveThreadPath } from "../features/keyboard/hardwareKeyboardCommands";
import { appAtomRegistry } from "../state/atom-registry";
import { useEnvironments } from "../state/environments";
import { papercutEnvironment } from "../state/papercuts";
import { useEnvironmentPresentation } from "../state/presentation";
import { useEnvironmentThread } from "../state/threads";
import { appBuildLabel } from "./appBuildLabel";
import { createStallDetector } from "./jsStallDetector";
import { papercutNative } from "./papercutNative";
import {
  bundleToCreateInput,
  isJsUnresponsive,
  parseBundle,
  type PapercutBundle,
  type PapercutContextSnapshot,
  type PapercutSurfaceInput,
} from "./papercutBundle";
import { registerPapercutReporter } from "./reportPapercut";

const HEARTBEAT_INTERVAL_MS = 1000;
/** A tick this much later than scheduled means the JavaScript thread was blocked. */
const STALL_THRESHOLD_MS = 1500;
/** Lets a closing sheet or palette finish dismissing before the screen is captured. */
const MENU_DISMISS_SETTLE_MS = 400;

const SURFACE_LABEL = Platform.OS === "ios" ? (Platform.isPad ? "ipad" : "iphone") : "android";

/** Bundles being prompted for or uploaded, so a drain never races the flow that owns them. */
const inFlightBundleIds = new Set<string>();

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Resolves with the note, "" when none was typed, or null when the user cancelled. */
function askForNote(): Promise<string | null> {
  if (Platform.OS !== "ios") return Promise.resolve("");
  return new Promise((resolve) => {
    Alert.prompt(
      "Report a papercut",
      "Saves what the app is doing, with a screenshot, to your environment.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        { text: "Save", onPress: (text?: string) => resolve(text ?? "") },
      ],
      "plain-text",
      "",
      "default",
    );
  });
}

/**
 * Hosts papercut reporting on mobile: feeds the shared event buffer, keeps the
 * native module's context and heartbeat current, and turns shakes and menu
 * items into uploaded reports. Mount once, under the navigation container.
 */
export function PapercutReporter(props: { readonly pathname: string }) {
  const threadRef = useMemo(() => parseActiveThreadPath(props.pathname), [props.pathname]);
  const { environments } = useEnvironments();
  const environmentId =
    threadRef?.environmentId ??
    environments.find((environment) => environment.connection.phase === "connected")
      ?.environmentId ??
    null;
  const threadState = useEnvironmentThread(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const { presentation } = useEnvironmentPresentation(environmentId);
  const connectionPhase = presentation?.connection.phase;
  const threadStatus = threadRef ? threadState.status : undefined;

  // Native callbacks and timers run outside React, so they read the latest render.
  const latest = useRef({
    environmentId,
    threadState,
    pathname: props.pathname,
    connectionPhase,
    threadStatus,
  });
  useEffect(() => {
    latest.current = {
      environmentId,
      threadState,
      pathname: props.pathname,
      connectionPhase,
      threadStatus,
    };
  });

  useEffect(() => {
    const surfaceInput = (): PapercutSurfaceInput => ({
      clientSurface: SURFACE_LABEL,
      buildSha: appBuildLabel(),
      platform: `${Platform.OS} ${String(Platform.Version)}`,
    });
    const snapshot = (): PapercutContextSnapshot => {
      const current = latest.current;
      const context = papercutThreadContext({
        environmentId: current.environmentId ?? undefined,
        thread: current.threadState.data._tag === "Some" ? current.threadState.data.value : null,
        route: current.pathname,
        threadStatus: current.threadStatus,
        connectionPhase: current.connectionPhase,
      });
      const pendingDispatchMs = papercutEvents.oldestOpenOperationAgeMs();
      return {
        input: {
          ...surfaceInput(),
          where: context.where,
          clientState: {
            ...context.clientState,
            ...(pendingDispatchMs === null ? {} : { pendingDispatchMs }),
          },
          messages: context.messages,
        },
        events: papercutEvents.snapshot(),
      };
    };

    /** Uploads one bundle and removes it from the device only once the server has it. */
    const upload = async (bundle: PapercutBundle, note: string | undefined, persisted: boolean) => {
      const live = isJsUnresponsive(bundle) ? undefined : snapshot();
      const input = bundleToCreateInput(bundle, { note, live, fallback: surfaceInput() });
      const targetEnvironmentId =
        input.evidence.where?.environmentId ?? latest.current.environmentId;
      if (!targetEnvironmentId) return false;
      const result = await runAtomCommand(
        appAtomRegistry,
        papercutEnvironment.create,
        { environmentId: EnvironmentId.make(targetEnvironmentId), input },
        { reportFailure: false, reportDefect: false },
      );
      if (result._tag !== "Success") return false;
      if (persisted) await papercutNative?.discardPending(bundle.id);
      return true;
    };

    const notifyOutcome = (saved: boolean) => {
      if (saved) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        return;
      }
      Alert.alert(
        "Could not save the papercut",
        "It is kept on this device and uploads when the environment is reachable.",
      );
    };

    /** The reporter owns `bundle` while it asks for a note and uploads. */
    const reportBundle = async (bundle: PapercutBundle, persisted: boolean) => {
      if (inFlightBundleIds.has(bundle.id)) return;
      inFlightBundleIds.add(bundle.id);
      try {
        const note = await askForNote();
        if (note === null) {
          if (persisted) await papercutNative?.discardPending(bundle.id);
          return;
        }
        notifyOutcome(await upload(bundle, note.trim() || undefined, persisted));
      } finally {
        inFlightBundleIds.delete(bundle.id);
      }
    };

    const reportFromMenu = async () => {
      await delay(MENU_DISMISS_SETTLE_MS);
      if (papercutNative) {
        const raw = await papercutNative.readPending(await papercutNative.capture("manual"));
        const bundle = raw === null ? null : parseBundle(raw);
        if (bundle) await reportBundle(bundle, true);
        return;
      }
      // No native module (Android, or an older iOS build): report without a screenshot.
      await reportBundle(
        {
          id: `js-${Date.now()}`,
          trigger: "manual",
          capturedAtMs: Date.now(),
          jsHeartbeatAgeMs: null,
        },
        false,
      );
    };

    let draining = false;
    /** Uploads bundles left from a shake while JavaScript was blocked, or a failed upload. */
    const drainPending = async () => {
      if (!papercutNative || draining) return;
      draining = true;
      try {
        for (const id of await papercutNative.listPending()) {
          if (inFlightBundleIds.has(id)) continue;
          const raw = await papercutNative.readPending(id);
          const bundle = raw === null ? null : parseBundle(raw);
          if (!bundle) {
            await papercutNative.discardPending(id);
            continue;
          }
          inFlightBundleIds.add(id);
          try {
            if (!(await upload(bundle, undefined, true))) return;
          } finally {
            inFlightBundleIds.delete(id);
          }
        }
      } finally {
        draining = false;
      }
    };

    const shakeSubscription = papercutNative?.addListener("onShake", ({ id }) => {
      void (async () => {
        const raw = await papercutNative?.readPending(id);
        const bundle = raw ? parseBundle(raw) : null;
        if (bundle) await reportBundle(bundle, true);
      })();
    });

    const stall = createStallDetector({
      intervalMs: HEARTBEAT_INTERVAL_MS,
      thresholdMs: STALL_THRESHOLD_MS,
      now: Date.now,
    });
    let storedContextKey = "";
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") {
        stall.reset();
        return;
      }
      papercutNative?.heartbeat();
      const lateBy = stall.tick();
      if (lateBy !== null) recordPapercutEvent("client.js-stall", String(lateBy));
      if (papercutNative) {
        // Hand over a fresh context only when something worth reporting changed.
        const current = snapshot();
        const key = `${JSON.stringify(current.input.where)}|${JSON.stringify(current.input.clientState)}|${current.events.at(-1)?.at ?? 0}`;
        if (key !== storedContextKey) {
          storedContextKey = key;
          papercutNative.setContext(JSON.stringify(current));
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      papercutNative?.heartbeat();
      stall.reset();
      void drainPending();
    });

    // Labels only: error messages can quote user content.
    const errorUtils = (
      globalThis as unknown as {
        ErrorUtils?: {
          getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
          setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
        };
      }
    ).ErrorUtils;
    const previousErrorHandler = errorUtils?.getGlobalHandler();
    errorUtils?.setGlobalHandler((error, isFatal) => {
      recordPapercutEvent(isFatal ? "client.fatal-error" : "client.error");
      previousErrorHandler?.(error, isFatal);
    });

    const unregister = registerPapercutReporter(reportFromMenu);
    void drainPending();

    return () => {
      unregister();
      clearInterval(timer);
      shakeSubscription?.remove();
      appStateSubscription.remove();
      if (previousErrorHandler) errorUtils?.setGlobalHandler(previousErrorHandler);
    };
  }, []);

  useEffect(() => {
    if (connectionPhase) recordPapercutEvent(`connection.${connectionPhase}`, environmentId ?? "");
  }, [connectionPhase, environmentId]);
  useEffect(() => {
    if (threadStatus) recordPapercutEvent(`thread.${threadStatus}`, threadRef?.threadId);
  }, [threadStatus, threadRef?.threadId]);

  return null;
}
