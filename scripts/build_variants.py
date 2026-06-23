#!/usr/bin/env python3
"""build_variants.py — the AI generation environment of the pipeline.

Two modes:

  # 1) Batch dry-run (default): re-checks the committed variant set through the
  #    harness gate. No AI, no network.
  python scripts/build_variants.py

  # 2) Agent loop (the real "AI Coding" closure): turn ONE human hypothesis into
  #    a working variant. claude emits a config (params + intent.targets), the
  #    harness measures it, and on REJECT the STRUCTURED failure is fed back and
  #    the params are regenerated — up to 3 times — before promote/abort.
  python scripts/build_variants.py --new "给熟练玩家的明快变体:节奏快、消除频繁、惊喜足,但保持公平且单局仍碎片化" --id ai-brisk

This is the LangGraph node graph collapsed into one readable script
(parse_spec -> generate_code -> run_harness -> reflect_and_fix), isomorphic to
the incident-dispatch-agent (告警解析→派单→核验→重派). The loop's whole point is
that the human↔parameter translation is LOSSY: the AI guesses params for a feel,
the harness measures whether the feel landed, and the measured gap is the
feedback that drives the fix. See docs/pipeline.md.

Auth note: we shell out to the `claude` CLI on the user's OAuth login (not the
SDK) and pop a stale machine-level ANTHROPIC_API_KEY from the subprocess env so
the CLI uses the subscription, not the dead key.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VARIANTS_DIR = ROOT / "config" / "variants"
SCHEMA = ROOT / "config" / "schema.json"
SPEC = ROOT / "spec.yaml"
NPM = "npm.cmd" if os.name == "nt" else "npm"
NODE = "node"
SHELL = os.name == "nt"


def claude_env():
    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)  # force OAuth subscription, not the dead key
    return env


# --- parse_spec -----------------------------------------------------------
def parse_spec():
    try:
        import yaml  # noqa
        spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
        return spec["variant_matrix"], spec.get("guardrails", {})
    except Exception:
        ids = sorted(p.stem for p in VARIANTS_DIR.glob("*.json"))
        return [{"variant_id": i} for i in ids], {}


# --- generate_code --------------------------------------------------------
def generate_variant(hypothesis, vid, feedback=None):
    """Ask claude for one variant JSON (params + intent.targets) for a hypothesis.

    `feedback` (the harness's structured per-target report from a prior failed
    attempt) is appended so the model adjusts PARAMS to move the measured proxies
    into its own declared bands.
    """
    schema = SCHEMA.read_text(encoding="utf-8")
    example = (VARIANTS_DIR / "control.json").read_text(encoding="utf-8")

    prompt = f"""You design ONE Block Blast puzzle variant as a JSON config, valid against the SCHEMA below.

The config MUST include an `intent` block:
  - `hypothesis`: the human feel-goal (use the one given verbatim).
  - `targets`: 3-4 entries, each {{proxy, band:[floor,ceiling], represents}}. A band side may be null (no limit). These are the MEASURABLE proxies the parameters must land inside.

Allowed proxies (all computed by a headless sim playing 100s of games):
  rescueRate     — fraction of piece-refills that needed the anti-deadlock safety net. LOWER = fairer. (>0.15 = the RNG keeps screwing the player)
  clearRate      — line-clears per move. Order/tempo. ~0.25 calm, ~0.5 busy.
  rewardEntropy  — Shannon bits over clear-size distribution. Surprise. <0.2 = monotonous/boring, >0.5 = varied.
  stepsP90       — 90th-pctile moves per game. Session length. <10 very short, >60 dragging.
  stepsMedian    — median moves per game.

Choose params (board / spawn / scoring / difficulty / juice) you predict will make the measured proxies fall INSIDE your declared bands. Bands are your contract; pick them honestly for the hypothesis, then pick params to hit them.

Return ONLY the JSON object, no prose. variant_id MUST be "{vid}".

HYPOTHESIS (use verbatim as intent.hypothesis): {hypothesis}

EXAMPLE (a valid variant — note the intent block):
{example}

SCHEMA:
{schema}"""

    if feedback:
        prompt += f"""

YOUR PRIOR ATTEMPT FAILED THE HARNESS. The sim measured (per your own declared bands):
{feedback}
Keep the SAME intent.targets bands. Adjust the PARAMS so the FAIL'd proxies move into band. Levers:
  rewardEntropy too low → allow bigger/varied pieces (shape_set "extended", big_piece_weight_mult up).
  stepsP90 too high (dragging) → smaller board or higher spawn.density. too low (dies fast) → bigger board / lower density / enable dda.
  rescueRate too high (unfair) → enable dda, lower density, avoid huge pieces.
  clearRate off → board size & density tune the clear cadence.
Return ONLY the corrected JSON."""

    proc = subprocess.run(
        ["claude", "-p", "--output-format", "text", "--model", "sonnet"],
        input=prompt, capture_output=True, text=True,
        env=claude_env(), shell=SHELL,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude failed: {proc.stdout or proc.stderr}")
    out = proc.stdout
    start, end = out.find("{"), out.rfind("}")
    if start < 0 or end < 0:
        raise RuntimeError(f"no JSON in claude output:\n{out[:500]}")
    return json.loads(out[start:end + 1])


# --- harness gates --------------------------------------------------------
def schema_gate(path):
    r = subprocess.run([NODE, "config/validate-cli.js", str(path)],
                       cwd=ROOT, capture_output=True, text=True, shell=SHELL)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def sim_and_verify(vid, games):
    """Run the sim (refreshes last-run.json incl. the candidate) then verify the
    one variant. Returns (promoted, structured_report)."""
    sim = subprocess.run([NODE, "harness/sim/headless-sim.js", "--games", str(games)],
                         cwd=ROOT, capture_output=True, text=True, shell=SHELL)
    if sim.returncode != 0:
        return False, "SIM GATE FAILED (crash or frame-budget):\n" + sim.stdout + sim.stderr
    ver = subprocess.run([NODE, "harness/verify/check-targets.js", vid, "--strict"],
                         cwd=ROOT, capture_output=True, text=True, shell=SHELL)
    return ver.returncode == 0, ver.stdout.strip()


# --- the agent loop -------------------------------------------------------
def run_agent_loop(hypothesis, vid, games, max_attempts=3):
    print(f"\n=== agent loop: generate variant '{vid}' from a hypothesis ===")
    print(f"hypothesis: {hypothesis}\n")
    path = VARIANTS_DIR / f"{vid}.json"
    feedback = None

    for attempt in range(1, max_attempts + 1):
        print(f"--- attempt {attempt}/{max_attempts} ---")
        print("  generate_code: asking claude…")
        try:
            cfg = generate_variant(hypothesis, vid, feedback)
        except Exception as e:
            print(f"  generation error: {e}")
            return False
        cfg["variant_id"] = vid
        path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        ok, log = schema_gate(path)
        if not ok:
            print(f"  schema_gate: FAIL\n{log}")
            feedback = "SCHEMA INVALID:\n" + log
            print("  reflect_and_fix: re-prompting with schema errors.\n")
            continue
        print("  schema_gate: OK")

        print(f"  run_harness: sim {games} games + verify…")
        promoted, report = sim_and_verify(vid, games)
        print(report)
        if promoted:
            print(f"\n✅ PROMOTED '{vid}' after {attempt} attempt(s) → config/variants/{vid}.json")
            return True
        feedback = report
        print("  reflect_and_fix: feeding the harness verdict back and retrying.\n")

    # Exhausted retries → don't ship a rejected variant.
    if path.exists():
        path.unlink()
    print(f"\n❌ REJECTED '{vid}' after {max_attempts} attempts — hypothesis not realized, "
          f"candidate discarded (not promoted).")
    return False


# --- batch dry-run (existing behavior) ------------------------------------
def run_batch(games):
    matrix, _ = parse_spec()
    print(f"parse_spec: {len(matrix)} variants")
    sim = subprocess.run([NODE, "harness/sim/headless-sim.js", "--games", str(games)],
                         cwd=ROOT, capture_output=True, text=True, shell=SHELL)
    print(sim.stdout)
    if sim.returncode != 0:
        print("GATE FAILED — variants not promoted.")
        sys.exit(1)
    ver = subprocess.run([NODE, "harness/verify/check-targets.js"],
                         cwd=ROOT, capture_output=True, text=True, shell=SHELL)
    print(ver.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--new", metavar="HYPOTHESIS", help="generate ONE new variant from a human hypothesis (live agent loop)")
    ap.add_argument("--id", help="variant_id for --new (e.g. ai-brisk)")
    ap.add_argument("--games", type=int, default=200, help="games/variant for the sim gate")
    args = ap.parse_args()

    if args.new:
        if not args.id:
            ap.error("--new requires --id")
        ok = run_agent_loop(args.new, args.id, args.games)
        sys.exit(0 if ok else 1)
    run_batch(args.games)


if __name__ == "__main__":
    main()
