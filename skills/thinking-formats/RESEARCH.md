# Thinking Formats — Research Backing

Effect sizes and citations for the three formats in SKILL.md. Reference material, not loaded on every think call.

## table (decision matrix / paradigm selection)

- **17.1pp oracle gap** — Select-then-Solve (arXiv 2604.06753, Apr 2026). 18,000 runs, 6 paradigms, 4 models, 10 benchmarks. Oracle per-task selection beats best fixed paradigm by 17.1pp. Learned embedding router recovers 37% of the gap (47.6% → 53.1% avg accuracy).
- **15pp degradation from wrong structure** — same paper. CoT degrades HumanEval by 15pp vs Direct. Step-by-step reasoning fights code generation.
- **+12.7pp at 3.2× compression** — Routed Graph Handoff (arXiv 2608.25277, Aug 2026). Structured format selection over NL on τ-retail. 155-token router, 0.15% overhead.
- **14.6pp regression without routing** — same paper. Forcing graph-only format on AppWorld without the router. The wrong format on the wrong task is costly.
- **Self-routing fails for weaker models** — Select-then-Solve. Qwen3-30B over-selects ReAct at 48%, no model ever selects Reflection. Selection needs task features, not self-assessment.

## pseudocode (structural planning)

- **+4.5–5.5pp over NL plans** — PGPO (arXiv 2506.01475, ACL'25 Findings, Jun 2025). P-code plans beat NL plans across Llama-2-7B/13B, Llama-3-8B, Mistral-7B on ALFWorld, WebShop, TextCraft. Consistent across models.
- **Better OOD generalization** — same paper. ALFWorld-Unseen: PGPO 76.9 vs IPR 74.7 (Llama-2-7B). Structure transfers; surface language doesn't.
- **Fewer interaction turns** — same paper. 12.14 (NL) → 10.99 (P-code) on ALFWorld-seen.
- **Fewer action errors and omissions** — same paper, analysis section. Specific failure: agent plans 5 steps, executes 3, gets stuck. Pseudocode makes the 5 steps visible.
- **Eliminates re-retrieve loop** — Skill-as-Pseudocode (arXiv 2605.27955, May 2026). Typed pseudocode gives deterministic invocation schema instead of re-deriving from prose.

## trace (state-transition diagnosis / structured verification)

- **50% token reduction** — SCR (arXiv 2601.07180, ICLR 2026, Jan 2026). Generate-Verify-Revise on MATH500. Explicit termination: model checks answer, stops if correct. Unstructured CoT has no stop condition.
- **Calibrated self-verification** — same paper. Base models: 92.96% recall, low precision (flag correct answers as wrong). SCR: higher F1. Structured check → better "this is correct, stop" judgment.
- **Generalizes beyond training domain** — same paper. Transfers to commonsense reasoning, not just math. Termination discipline is domain-independent.
- **Interleaved > upfront** — Think Anywhere (arXiv 2603.29957, Mar 2026). Reasoning at each state-change point during code generation outperforms reasoning only at the start. "Problems' full complexity only reveals itself during implementation."

## Related work

- **ThinC / Thinking in Code** (arXiv 2605.07237, May 2026): code as reasoner, 99.2% grounded in interpreter output. 4B beats 235B. This is the *execution* side (repl/bash), not the *format* side.
- **Inducing Reasoning Primitives** (arXiv 2606.02994, Jun 2026): mines agent traces, clusters recurrent reasoning moves, converts to typed pseudo-tools. +44pp on RuleArena. Formats can be induced from traces, not just hand-authored.
- **Learning When to Think** (arXiv 2608.20256, Aug 2026): model learns NoThink/Short/Long as first token via GRPO. 41% token reduction. The "how much" axis, complementary to the "what format" axis.
- **thinking-toolkit** (GitHub, Jul 2026): 30 thinking models as a portable agent skill. Selection cues, contrast rules, anti-patterns. Closest existing implementation of format selection.
