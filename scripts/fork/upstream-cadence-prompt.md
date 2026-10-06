Review the upstream sync cadence using only the supplied deterministic facts and recent decision ledger. Return one JSON object, with no Markdown fences or extra output:

{"intervalHours":24,"reason":"one paragraph explaining the decision","analysis":"short analysis of upstream volume, conflicts, noise, and survival of clean merges"}

Use commits and changed files per day over 14 and 28 days, run outcomes, conflict paths and counts, landed candidates, and clean-merge survival. Increase frequency when volume or conflicts grow and conflicts worsen with merge age; decrease it when runs are clean no-ops. Bounds: 6 to 168 hours, at most a factor of two from the previous interval per review. An unchanged interval still needs analysis and a reason. This is an autonomous decision; do not request approval. Do not run tools or change files. No private message content is supplied or needed.
