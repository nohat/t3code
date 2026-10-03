import type {
  OrchestrationThread,
  PapercutClientState,
  PapercutMessage,
  PapercutWhere,
} from "@t3tools/contracts";
import { PAPERCUT_MAX_MESSAGES } from "@t3tools/contracts";

import { derivePendingRequests } from "../pendingRequests.ts";

export interface PapercutThreadContextInput {
  readonly environmentId?: string | undefined;
  readonly thread: OrchestrationThread | null;
  readonly route?: string | undefined;
  /** The thread's sync status, such as "live" or "synchronizing". */
  readonly threadStatus?: string | undefined;
  /** The environment connection phase, such as "connected" or "reconnecting". */
  readonly connectionPhase?: string | undefined;
}

export interface PapercutThreadContext {
  readonly where: PapercutWhere;
  readonly clientState: PapercutClientState;
  /** Message text is local-only; it never joins the evidence group. */
  readonly messages: ReadonlyArray<PapercutMessage>;
}

/**
 * Turns what a client already holds about the active thread into the thread
 * parts of a papercut. Reads state only; nothing is fetched.
 */
export function papercutThreadContext(input: PapercutThreadContextInput): PapercutThreadContext {
  const { thread } = input;
  const turnId = thread?.latestTurn?.turnId ?? thread?.session?.activeTurnId ?? undefined;
  const pending = thread ? derivePendingRequests(thread.activities) : undefined;

  return {
    where: {
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      ...(thread ? { threadId: thread.id } : {}),
      ...(turnId ? { turnId } : {}),
      ...(thread
        ? {
            provider: thread.modelSelection.instanceId,
            model: thread.modelSelection.model,
            runtimeMode: thread.runtimeMode,
          }
        : {}),
      ...(input.route ? { route: input.route } : {}),
    },
    clientState: {
      ...(input.connectionPhase ? { connection: input.connectionPhase } : {}),
      ...(input.threadStatus ? { threadSyncPhase: input.threadStatus } : {}),
      ...(pending
        ? {
            pendingUserInput: pending.userInputs.length > 0,
            pendingApproval: pending.approvals.length > 0,
          }
        : {}),
    },
    messages: (thread?.messages ?? [])
      .flatMap((message) =>
        message.role === "reasoning"
          ? []
          : [{ role: message.role, text: message.text, at: message.createdAt }],
      )
      .slice(-PAPERCUT_MAX_MESSAGES),
  };
}
