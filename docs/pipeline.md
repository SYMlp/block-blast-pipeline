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
[Harness — L1/L2 real, L3 skel] 3. Verify (Vitest invariants + headless sim; LLM judge = skeleton)
   |  fail -> reflect_and_fix loop (skeleton, not wired)
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
            | run_harness  |  Layer1 invariants -> Layer2 sim  (both REAL, in CI)
            +---+------+---+  Layer3 LLM judge = skeleton, not wired in
            pass|      |fail
                |      v
                |  +------------------+
                |  | reflect_and_fix  |  SKELETON (not wired): would append the
                |  +--------+---------+  harness log to the prompt and retry
                |           |            generate_code (<= 3 retries else abort)
                |           +--> (loop back to generate_code)
                v
            +--------------+
            |  git_commit  |  promote validated config to config/variants/ + dist/
            +--------------+
```

Solid path (parse_spec -> generate_code -> run_harness L1/L2 -> git_commit) is
what actually runs. The dashed pieces — `reflect_and_fix` and Layer 3 LLM judge
— are scaffolded (prompt assembly and the claude call are real) but **not wired
into the main loop**: the committed variants already pass, so the demo never
enters the self-fix branch.

## Why this is the same machine as incident-dispatch-agent

This Spec -> generate -> verify -> self-fix state machine is **isomorphic** to
incident-dispatch-agent — my own practice project (automated metric-alert
dispatch) that I got running locally first. It is not a new architecture; it is
the same skeleton with a different payload:

| incident-dispatch-agent (my practice project) | block-blast-pipeline |
|---|---|
| parse alert / classify | `parse_spec` (read variant matrix) |
| dispatch to on-call | `generate_code` (emit variant config) |
| verify dispatch correctness | `run_harness` (invariants + sim) |
| re-dispatch on failure | `reflect_and_fix` (re-prompt + retry) — skeleton here |
| guardrails / HITL / circuit breaker / observability | same governance pieces, same idea |

The work tag is "AI Coding" not "game dev": the reusable part is the verifiable
generation loop, and the game is what happens to be flowing through it. That
other project is not in this repo and has no public link — this note only
explains where the skeleton came from, not that it shipped to a real enterprise.
