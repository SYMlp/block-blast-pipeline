# Cocos mapping — and an honest statement of the gap

This demo uses zero-dependency vanilla JS + Canvas, **not Cocos Creator**. That
is a deliberate choice, not an accident: it keeps the pipeline logic pure and
headless-testable, free of engine lifecycle noise. The pipeline architecture
(Spec -> generate -> Harness -> config-driven variants) is engine-agnostic. What
follows is the concept-for-concept correspondence and an honest read on
migration cost.

## Concept correspondence

| This repo (vanilla JS) | Cocos Creator (TS) | Notes |
|---|---|---|
| `engine/` pure-logic ES modules | plain TS classes, not `Component`s | Already engine-free — ports almost as-is to TS |
| `renderer/CanvasRenderer.js` (manual ctx draw) | `Sprite` / `Graphics` + a `Component` per cell, or one draw component | Largest rewrite; Cocos owns the render loop |
| `easeOutBack` / popup tweens | `cc.tween(node).to(...).start()` | Hand-rolled easing -> built-in `tween()` |
| Particle burst in `CanvasRenderer` | `ParticleSystem2D` | Built-in, less code, GPU-backed |
| Screen-shake `addShake` (translate ctx) | tween the `Camera` / root node position | Same trauma model, different target |
| `requestAnimationFrame` loop | `update(dt)` on a `Component` | Cocos drives the loop; you implement `update` |
| `config/variants/*.json` + `ConfigLoader` | same JSON, loaded via `resources.load` / Remote Config | Config layer is fully reusable |
| `harness/sim/headless-sim.js` (Node) | Cocos headless / a Node harness over the same TS logic | Because logic is engine-free, the sim ports unchanged |
| `index.html` `?variant=` switch | scene param / Remote Config bucket | Same idea |

## What actually has to change (the real cost)

1. **Render layer rewrite** — the Canvas draw calls become Cocos nodes /
   components. This is the bulk of the work, and it is purely the *payload*
   layer, not the pipeline.
2. **TS types** — the engine gains explicit interfaces (`GameConfig`,
   `Piece`, `Board`). Mechanical, low-risk.
3. **Asset/scene wiring** — prefabs, atlases, the Cocos project structure.

## What does NOT change (the point)

The pipeline — Spec, the LangGraph generation loop, the three Harness layers,
the config schema, the headless sim — is independent of the engine. Because
`engine/` has zero DOM and the sim runs in Node, **the verification machine
moves over intact**. The migration cost lives in the render payload and TS
typing, not in the architecture that makes variant generation verifiable. That
is the load-bearing claim of this whole project.
