---
name: t3-model-selection
description: Choose a provider instance and model for delegated or launched T3 work using live pricing and recent use from orchestrator_capabilities. Use before delegate_task or t3_thread_launch when the model is yours to pick, or when asked which model to delegate to.
---

# T3 model selection

Fork-only skill. It applies to any agent running inside T3 Code, whatever its
own provider or model.

## Workflow

1. Call `orchestrator_capabilities`. Pick from its `providers` only: use the
   exact `providerInstanceId` and model `id`. Skip providers whose
   `canRunChildTask` is false and read their `constraints`. Do not assume a
   model is available because a similarly named one is.
2. Read each model's optional fields:
   - `pricing`: estimated USD per million tokens (input, output, cache read,
     cache write). `isCustomRate` means the server owner entered it.
     A missing `pricing` means unknown, never free.
   - `recentThreadCount`: threads in this environment that ran the model in
     the last 14 days. It shows the model has been tried here, nothing about
     quality or success.
   - `options`: selectable model options such as reasoning effort.
3. Choose the cheapest model that can reasonably do the task. Spend more only
   when the task needs it (hard reasoning, large refactors, long context).
4. Dispatch:
   - A child of this thread: `delegate_task` with a title, a self-contained
     `task`, and a `target` naming `providerInstanceId`, `model`, and
     `options`. Cross-provider works; the child shares this thread's project.
   - Independent or other-project work: `t3_thread_launch` with `projectId`
     and `modelSelection: { instanceId, model, options }`.
5. Follow up: `task_status` with the returned task id for delegated work;
   `t3_thread_read` or `t3_thread_wait` for a launched thread.

## Reading cost

- Raw estimate: input tokens times the input rate plus output tokens times
  the output rate, with cache rates applied to cached tokens.
- Rates are API-list equivalents, not the bill. Claude, Codex, and Cursor are
  often paid by subscription, so a choice may spend quota rather than money.
- Total spend is not a quality signal. Prompt size, cache hits, output length,
  and retries all move it.
