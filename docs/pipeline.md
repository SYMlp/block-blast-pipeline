# Pipeline — full picture + LangGraph node graph

## The six workstations

A casual-game studio that runs 10k+ A/B experiments a year cannot hand-write
variants. The only way to hit that volume is to treat variants as **data
emitted by a pipeline**, with verification fast enough that nobody reviews each
one by hand. This repo is the minimal-but-complete version of that pipeline.

```
[Spec (spec.yaml)]              1. Declare intent (variant matrix + EARS AC + guardrails)
   |  variant matrix + acceptance criteria
   v
[Coding Agent (LangGraph)]       2. Generate (parse_spec -> generate_code)
   |  base engine + per-variant overrides -> config JSON
   v
[Harness — 3 layers]             3. Verify (Vitest invariants / headless AI player / LLM judge)
   |  fail -> reflect_and_fix loop (<= 3 retries)
   v
[Config-driven variants]         4. Produce (N validated JSON configs)
   |  same engine, different behavior; prod would hash-bucket via Firebase
   v
[Engine reads config]            5. Payload (Game Juice + scoring + board)
   |  every event tagged with variant_id
   v
[Metrics -> 3-stage funnel]      6. Feedback (D1 retention / session length / ad revenue)
```

## LangGraph node graph

The generation environment (`scripts/build_variants.py`) is this state graph
collapsed into one readable script. In production it runs as an actual
LangGraph `StateGraph` with a checkpointer (so a 300-variant batch can resume
mid-run), a circuit breaker on the retry edge, and LangSmith tracing.

```
            +-------------+
            | parse_spec  |   read spec.yaml: variant matrix + guardrails
            +------+------+
                   |
                   v
            +--------------+
            | generate_code |  per variant: overrides -> claude -p -> config JSON
            +------+--------+
                   |
                   v
            +--------------+
            | run_harness  |  Layer1 invariants -> Layer2 sim -> Layer3 judge
            +---+------+---+
            pass|      |fail
                |      v
                |  +------------------+
                |  | reflect_and_fix  |  append structured harness log to prompt,
                |  +--------+---------+  retry generate_code (retries <= 3 else abort)
                |           |
                |           +--> (loop back to generate_code)
                v
            +--------------+
            |  git_commit  |  promote validated config to config/variants/ + dist/
            +--------------+
```

## Why this is the same machine as incident-dispatch-agent

This Spec -> generate -> verify -> self-fix state machine is **isomorphic** to
my enterprise agent project (incident-dispatch-agent — automated metric-alert
dispatch). It is not a new architecture; it is the same one with a different
payload:

| incident-dispatch-agent | block-blast-pipeline |
|---|---|
| parse alert / classify | `parse_spec` (read variant matrix) |
| dispatch to on-call | `generate_code` (emit variant config) |
| verify dispatch correctness | `run_harness` (invariants + sim + judge) |
| re-dispatch on failure | `reflect_and_fix` (re-prompt + retry) |
| guardrails / HITL / circuit breaker / observability | same five governance pieces |

The work tag is "AI Coding" not "game dev": the reusable asset is the
verifiable generation loop, and the game is what happens to be flowing through
it. The five governance pieces (guardrails, HITL interrupt, circuit breaker,
eval, observability) port over wholesale.
