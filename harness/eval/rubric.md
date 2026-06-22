# Harness Layer 3 — LLM-as-Judge Rubric

> Scores an AI-generated variant (config + any generated engine glue) on five
> dimensions, 10 points each. Gate threshold: every dimension >= 7, else the
> variant is rejected and bounced back to `reflect_and_fix`. This is the
> evaluation layer of Harness Engineering — the reviewer is the agent loop,
> not a human, so the output must be machine-parseable JSON.

## Dimensions

| # | Dimension | What "10" looks like | What "<7" looks like |
|---|-----------|----------------------|----------------------|
| 1 | **Correctness** | Config passes JSON Schema; all 6 unit invariants hold; sim 0 crashes | Schema invalid, or any invariant violated, or a crash in sim |
| 2 | **Readability** | Clear field names, no dead params, diffs from control are intentional | Magic numbers, params that contradict each other |
| 3 | **Performance** | Sim worst single-step < 16ms (one frame); no pathological board sizes | Step time spikes, or board so large the sim drags |
| 4 | **Spec compliance** | Every field within schema bounds AND matches the variant's stated intent in spec.yaml | Param drifts from declared intent (e.g. "relaxed" but density 0.9) |
| 5 | **Differentiation** | Sim metrics measurably differ from control (avg survival / score outside noise band) | Variant is statistically indistinguishable from control |

## Output contract (the judge MUST return exactly this JSON)

```json
{
  "variant_id": "compact",
  "scores": { "correctness": 9, "readability": 8, "performance": 10, "spec_compliance": 9, "differentiation": 8 },
  "min_score": 8,
  "verdict": "pass",
  "notes": "1-3 sentences: what to fix if any dimension < 7."
}
```

## Few-shot anchor

A `relaxed` variant with `board 10x10`, `density 0.3`, `shape_set minimal`
that the sim shows surviving ~3x longer than control with ~2.5x the score is a
clean **pass** (differentiation = 9): the intent ("more breathing room") is
borne out by the headless player's behavior, not just asserted in prose.
