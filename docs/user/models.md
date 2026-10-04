# Models

The Models view compares the models T3 offers to run. Open it from the sidebar
or the command palette ("Open models"), or press `mod+alt+m`.

Each row shows the model, its maker and release month, a frontier-relative
**Capability** score where published benchmark evidence is sufficient, its
relative **Profile** (strengths and weaknesses), the synthetic **Blended $/M**
price, generation speed, context window, and OpenRouter usage. Columns sort by
clicking their header.

- **Capability** is a benchmark-derived score relative to contemporary frontier
  models. It is not a probability of succeeding at your task, and it is left
  blank with a reason when there is not enough published evidence.
- **Blended $/M** is a comparison rate built from a fixed 70% cached-input /
  20% input / 10% output mix using a serving provider's published rates. It is
  not an estimate of what a task will cost. The usage page shows estimated spend
  instead.
- **Profile** marks categories where a model performs above or below models of
  comparable overall capability, not absolute category scores.

Select rows to build a side-by-side comparison, and toggle **Capability × price**
to plot published scores against blended price. A model with no published
capability or price is omitted from the plot rather than shown at zero.

Select a row to open its detail: provider intent and observed profile summaries
with their sources, the capability breakdown with coverage and methodology
version, the provider rate cards behind the blended price, measured speed, usage
signals with their platform and window, technical capabilities, and the sources
the entry was built from.

Data is bundled and versioned; the view reports how recently it was refreshed.
Missing values are shown as `—` or an explicit reason, never as zero.
