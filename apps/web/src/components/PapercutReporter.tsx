import { useAtomValue } from "@effect/atom-react";
import {
  capturePapercut,
  papercutThreadContext,
  recordPapercutEvent,
} from "@t3tools/client-runtime/papercut";
import { useLocation, useParams } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { readSendButtonState } from "../papercuts/readSendButtonState";
import {
  closePapercutPrompt,
  openPapercutPrompt,
  registerPapercutContext,
  usePapercutPromptRequest,
  type PapercutPromptRequest,
} from "../papercuts/papercutPrompt";
import { useEnvironmentPresentation } from "../state/presentation";
import { papercutEnvironment } from "../state/papercuts";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { useEnvironmentThread } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { toastManager } from "./ui/toast";

const MENU_ACTION = "report-papercut";

/**
 * Hosts the "Report a papercut" flow: keeps the current app state readable for
 * a report, feeds the client event buffer, and shows the one-line note prompt.
 * Entry points call `openPapercutPrompt`.
 */
export function PapercutReporter() {
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const pathname = useLocation({ select: (location) => location.pathname });
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const threadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const environmentId = threadRef?.environmentId ?? primaryEnvironmentId;
  const threadState = useEnvironmentThread(
    threadRef?.environmentId ?? null,
    threadRef?.threadId ?? null,
  );
  const { presentation } = useEnvironmentPresentation(environmentId);
  const connectionPhase = presentation?.connection.phase;
  const threadStatus = threadRef ? threadState.status : undefined;

  // The registered reader runs outside React, so it reads the latest render.
  const latest = useRef({ environmentId, threadState, pathname, connectionPhase, threadStatus });
  useEffect(() => {
    latest.current = { environmentId, threadState, pathname, connectionPhase, threadStatus };
  });

  useEffect(
    () =>
      registerPapercutContext(() => {
        const current = latest.current;
        const context = papercutThreadContext({
          environmentId: current.environmentId ?? undefined,
          thread: current.threadState.data._tag === "Some" ? current.threadState.data.value : null,
          route: current.pathname,
          threadStatus: current.threadStatus,
          connectionPhase: current.connectionPhase,
        });
        return {
          environmentId: current.environmentId,
          input: {
            clientSurface: window.desktopBridge ? "desktop" : "web",
            buildSha: import.meta.env.APP_VERSION,
            platform: window.desktopBridge?.getClientPlatform?.() ?? navigator.platform,
            where: context.where,
            clientState: { ...context.clientState, ...readSendButtonState(document) },
            messages: context.messages,
          },
        };
      }),
    [],
  );

  useEffect(() => {
    if (connectionPhase) recordPapercutEvent(`connection.${connectionPhase}`, environmentId ?? "");
  }, [connectionPhase, environmentId]);
  useEffect(() => {
    if (threadStatus) recordPapercutEvent(`thread.${threadStatus}`, threadRef?.threadId);
  }, [threadStatus, threadRef?.threadId]);
  useEffect(() => {
    // Labels only: error messages can quote user content.
    const onError = () => recordPapercutEvent("client.error");
    const onRejection = () => recordPapercutEvent("client.unhandledrejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action === MENU_ACTION) void openPapercutPrompt();
      }),
    [],
  );

  const request = usePapercutPromptRequest((state) => state.request);
  return request ? <PapercutPrompt request={request} /> : null;
}

function PapercutPrompt({ request }: { readonly request: PapercutPromptRequest }) {
  const [note, setNote] = useState("");
  const create = useAtomCommand(papercutEnvironment.create, { reportFailure: false });

  const submit = async () => {
    closePapercutPrompt();
    if (request.environmentId === null) {
      toastManager.add({
        type: "error",
        title: "Could not save the papercut",
        description: "No environment is connected.",
      });
      return;
    }
    const result = await create({
      environmentId: request.environmentId,
      input: capturePapercut({
        ...request.input,
        note,
        screenshot: request.screenshot,
      }),
    });
    if (AsyncResult.isSuccess(result)) {
      toastManager.add({ type: "success", title: "Papercut saved", timeout: 2000 });
    } else {
      toastManager.add({
        type: "error",
        title: "Could not save the papercut",
        description: "Check the connection to the environment and try again.",
      });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closePapercutPrompt();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Report a papercut</DialogTitle>
            <DialogDescription>
              Saves what the app is doing right now, with recent messages
              {request.screenshot ? " and a screenshot" : ""}, to your environment.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              nativeInput
              aria-label="Note"
              placeholder="What went wrong? (optional)"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closePapercutPrompt}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
