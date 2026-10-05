import type {
  OrchestrationV2ThreadProjection,
  PapercutClientState,
  PapercutMessage,
  PapercutWhere,
} from "@t3tools/contracts";
import { PAPERCUT_MAX_MESSAGES } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { derivePendingThreadRequests } from "../state/threadRequests.ts";

export interface PapercutThreadContextInput {
  readonly environmentId?: string | undefined;
  /** The open thread's projection, as held in the client's thread state. */
  readonly thread: OrchestrationV2ThreadProjection | null;
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
  // The newest run stands in for the turn: it is the active one while a turn runs.
  const turnId = thread?.runs.toSorted((left, right) => right.ordinal - left.ordinal)[0]?.id;
  const pending = thread ? derivePendingThreadRequests(thread) : undefined;

  return {
    where: {
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      ...(thread ? { threadId: thread.thread.id } : {}),
      ...(turnId ? { turnId } : {}),
      ...(thread
        ? {
            provider: thread.thread.modelSelection.instanceId,
            model: thread.thread.modelSelection.model,
            runtimeMode: thread.thread.runtimeMode,
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
    messages: (thread?.messages ?? []).slice(-PAPERCUT_MAX_MESSAGES).map((message) => ({
      role: message.role,
      text: message.text,
      at: DateTime.formatIso(message.createdAt),
    })),
  };
}
