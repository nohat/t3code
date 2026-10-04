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
  isOwnedByLiveFlow,
  parseBundle,
  routeLabel,
  type PapercutBundle,
  type PapercutContextSnapshot,
  type PapercutSurfaceInput,
} from "./papercutBundle";
import { registerPapercutReporter } from "./reportPapercut";

const HEARTBEAT_INTERVAL_MS = 1000;
/** A tick this much later than scheduled means the JavaScript thread was blocked. */
const STALL_THRESHOLD_MS = 1500;
/** Building the context walks the thread's messages and activities, so it is not done every tick. */
const CONTEXT_REFRESH_TICKS = 3;
/** How often leftover bundles are retried when nothing else prompts it. */
const PENDING_RETRY_INTERVAL_MS = 30_000;
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
  const connectedEnvironmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const latest = useRef({
    connectedEnvironmentIds,
    environmentId,
    threadState,
    pathname: props.pathname,
    connectionPhase,
    threadStatus,
  });
  const drainPendingRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    latest.current = {
      connectedEnvironmentIds,
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
        route: routeLabel(current.pathname),
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
      const input = bundleToCreateInput(bundle, {
        note: note ?? bundle.note,
        live: snapshot(),
        nowMs: Date.now(),
        fallback: surfaceInput(),
      });
      // The environment the report was about, unless it is gone: then the one in use now.
      const current = latest.current;
      const recordedEnvironmentId = input.evidence.where?.environmentId;
      const targetEnvironmentId =
        recordedEnvironmentId &&
        current.connectedEnvironmentIds.some((id) => id === recordedEnvironmentId)
          ? recordedEnvironmentId
          : current.environmentId;
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

    const notifyOutcome = (saved: boolean, persisted: boolean) => {
      if (saved) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        return;
      }
      Alert.alert(
        "Could not save the papercut",
        persisted
          ? "It is kept on this device and uploads when the environment is reachable."
          : "Check the connection to the environment and try again.",
      );
    };

    /**
     * Asks for a note and uploads. The caller has put `bundle.id` in
     * `inFlightBundleIds`, so a drain leaves it alone while the prompt is open.
     */
    const reportBundle = async (bundle: PapercutBundle, persisted: boolean) => {
      const note = await askForNote();
      if (note === null) {
        if (persisted) await papercutNative?.discardPending(bundle.id);
        return;
      }
      const trimmed = note.trim() || undefined;
      const saved = await upload(bundle, trimmed, persisted);
      // A note typed for a failed upload must survive until the retry.
      if (!saved && persisted && trimmed) await papercutNative?.setNote(bundle.id, trimmed);
      notifyOutcome(saved, persisted);
    };

    const reportFromMenu = async () => {
      await delay(MENU_DISMISS_SETTLE_MS);
      if (!papercutNative) {
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
        return;
      }
      const id = await papercutNative.capture("manual");
      inFlightBundleIds.add(id);
      try {
        const raw = await papercutNative.readPending(id);
        const bundle = raw === null ? null : parseBundle(raw);
        if (bundle) await reportBundle(bundle, true);
      } finally {
        inFlightBundleIds.delete(id);
      }
    };

    let draining = false;
    /** Uploads bundles left from a shake while JavaScript was blocked, or from a failed upload. */
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
          // A bundle from a responsive shake belongs to the prompt flow for a while.
          if (isOwnedByLiveFlow(bundle, Date.now())) continue;
          // Re-checked: the live flow may have claimed it while the file was read.
          if (inFlightBundleIds.has(id)) continue;
          inFlightBundleIds.add(id);
          try {
            // One bundle that cannot upload must not hold back the ones behind it.
            await upload(bundle, undefined, true);
          } finally {
            inFlightBundleIds.delete(id);
          }
        }
      } finally {
        draining = false;
      }
    };

    const shakeSubscription = papercutNative?.addListener("onShake", ({ id }) => {
      // Claimed before any await so a concurrent drain cannot upload it without the prompt.
      if (inFlightBundleIds.has(id)) return;
      inFlightBundleIds.add(id);
      void (async () => {
        try {
          const raw = await papercutNative?.readPending(id);
          const bundle = raw ? parseBundle(raw) : null;
          if (bundle) await reportBundle(bundle, true);
        } finally {
          inFlightBundleIds.delete(id);
        }
      })();
    });

    const stall = createStallDetector({
      intervalMs: HEARTBEAT_INTERVAL_MS,
      thresholdMs: STALL_THRESHOLD_MS,
      now: Date.now,
    });
    let storedContextKey = "";
    let tickCount = 0;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") {
        stall.reset();
        return;
      }
      papercutNative?.heartbeat();
      const lateBy = stall.tick();
      tickCount += 1;
      if (lateBy !== null) {
        recordPapercutEvent("client.js-stall", String(lateBy));
        // A shake during this stall left a bundle that nothing else would upload promptly.
        void drainPending();
      } else if (tickCount % (PENDING_RETRY_INTERVAL_MS / HEARTBEAT_INTERVAL_MS) === 0) {
        void drainPending();
      }
      if (papercutNative && tickCount % CONTEXT_REFRESH_TICKS === 0) {
        // Hand over a fresh context only when something worth reporting changed.
        const current = snapshot();
        const key = `${JSON.stringify(current.input.where)}|${JSON.stringify(current.input.clientState)}|${current.events.at(-1)?.at ?? 0}|${current.input.messages?.length ?? 0}`;
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
    drainPendingRef.current = drainPending;
    void drainPending();

    return () => {
      unregister();
      drainPendingRef.current = null;
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
    // A bundle whose upload failed for lack of a connection goes up when one returns.
    if (connectionPhase === "connected") void drainPendingRef.current?.();
  }, [connectionPhase]);
  useEffect(() => {
    if (threadStatus) recordPapercutEvent(`thread.${threadStatus}`, threadRef?.threadId);
  }, [threadStatus, threadRef?.threadId]);

  return null;
}
