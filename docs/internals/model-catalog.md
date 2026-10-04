# Model catalog

The `/models` dashboard renders a versioned catalog artifact, not live state. The
artifact is produced offline by a reproducible refresh job and bundled into every
client, so web, desktop, and mobile read the same data with no per-user server
state and no third-party fetch while rendering.

## Layering

- **Observations** are the leaf records: identity facts, prices, benchmark
  results, speed measurements, and adoption signals, each with a source id,
  retrieval time, and where available a publisher date and conditions. They live
  in `packages/contracts/src/modelCatalog.ts` and are retained unchanged.
- **Derived metrics** are computed from observations by pure functions under
  `apps/server/src/modelCatalog/` and recorded with the methodology version and
  the input observation ids that produced them.
- **Presentation** is `@t3tools/shared/modelCatalog` plus the route components
  under `apps/web/src/components/models/`. It formats stored values and never
  recomputes or invents one.

Missing data stays missing. A field the sources did not publish is absent from
the artifact, rendered as an em dash or an explicit "not measured" reason, and
sorted last. An unpublished capability score carries `withheldReason` rather
than a zero.

## Methodology

Methodology versions and weights are contract constants
(`MODEL_CATALOG_METHODOLOGY`). Derived metrics carry the version that produced
them so a methodology change is distinguishable from a model change.

- **Blended price** (`blend-70-20-10-v1`) is
  `0.70 * cacheRead + 0.20 * input + 0.10 * output`. All three source rates must
  exist on the same serving offer; otherwise the blend is unavailable. It is a
  synthetic comparison rate, distinct from the usage page's per-token estimates
  and never an estimate of task cost.
- **Capability** (`capability-frontier-mean-v1`) normalizes each published
  benchmark onto a 0–100 scale with a benchmark-specific transform (accuracy,
  published index, or Elo expected score against a fixed reference), averages per
  family, expresses each family relative to its frontier reference, and maps the
  composite against the frontier cluster. An overall score is published only with
  both general-reasoning and coding evidence plus at least four families; the
  publication rules live in `PUBLICATION_RULES`.
- **Specialization** (`specialization-ols-residual-v1`) is the residual of a
  family's score against a least-squares regression of that family on overall
  capability across published models. It needs at least three comparable models.
- **Adoption** (`openrouter-adoption-ccby-v1`) derives ranks and 7-/30-day
  momentum from OpenRouter's daily rankings. It describes OpenRouter traffic over
  a bounded window and is never presented as global adoption or as capability.

A language model never calculates a price, benchmark score, rank, or trend.

## Refresh

`apps/server/scripts/refresh-model-catalog.ts` fetches the configured sources,
retains raw responses with content hashes and publisher/license metadata, runs
deterministic adapters (`apps/server/src/modelCatalog/sources/`), and rebuilds
the artifact via `buildCatalog`. Without credentials or when a source fails, the
prior observations are retained so a partial refresh never drops data.

Sources are matched to canonical models only through explicit source-qualified
aliases (`crosswalk.ts`); display names are never used as a join key. OpenRouter
rates are a distinct routed serving offer, not substituted for a maker's direct
rate card. OpenRouter Data API responses are CC BY 4.0 and carry their required
attribution. API keys are read from the refresh environment and never written to
the artifact or a client bundle.

The committed artifact lives at
`packages/shared/src/modelCatalog/catalog.json`; regenerate it with
`node apps/server/scripts/refresh-model-catalog.ts --offline` for seed-only work.

## Descriptions

Provider-intent and observed-profile summaries are generated through T3's
configured text-generation service (`generateModelSummary`), never during
rendering and never by a hard-coded model. Each stored summary records the
prompt version, configured provider/model selection, source observation ids and
URLs, generation time, schema/quote/unsupported-number validation, and review
status. A summary that fails validation is retained as rejected with its reason
rather than silently replaced; summaries awaiting review are labeled as pending.
