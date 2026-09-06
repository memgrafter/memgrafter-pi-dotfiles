---
name: thinking-formats
description: Select the right thinking format before you call think. Table for decisions (17pp oracle gap, 15pp cost of wrong format), pseudocode for plans (+5pp, fewer skipped steps), trace for diagnosis (50% fewer tokens, finds the exact divergence line). The format is the structure of your reasoning, not the content.
---

Pick a format, think in it, commit. The format constrains *how* you organize the reasoning. The content is still yours.

## Why use it

The structure is the intervention. Same model, same token budget, different organization → different outcome. Three research-backed formats cover the full cycle of a coding agent's work: decide → plan → diagnose.

- **Wrong format costs up to 15pp.** CoT degrades HumanEval code quality by 15pp vs Direct (Select-then-Solve, 18,000 runs). A verbose reasoning structure on a task that needs direct action adds errors, not insight.
- **Right format is worth 17pp.** Oracle per-task format selection beats the best fixed format by 17.1pp on average. Even a lightweight selection recovers 37% of that gap.
- **It makes your reasoning auditable.** A table shows which options you considered and which criterion decided it. Pseudocode shows which steps you planned and which you skipped. A trace shows the exact line where state diverged. Freeform prose hides all three, and you can't re-read a hidden decision.

## When to use

Call `think` with a `format` tag when you are about to:

- **Choose between 2+ approaches, APIs, libraries, or patterns** → `table`
- **Plan a multi-step change before writing code** → `pseudocode`
- **Diagnose a bug, react to a failed test, or check why a tool returned something unexpected** → `trace`

## When NOT to use

- **Deterministic step.** `git status`, `ls`, a single-line edit, a rename. Don't think at all. The format adds structure, not insight, and the think call is pure overhead.
- **You already know the answer.** If the next action is obvious and you've done it a hundred times, skip the think call.
- **You need to execute code.** That's `repl` or `bash`. Thinking in code *format* means writing code as reasoning (tracing through it mentally, checking edge cases on paper), not running it. If you need the actual output, use the tool.
- **You're in the middle of a trace and need to check a value.** Use `repl` or `bash` to get the value, then continue the trace. Don't guess inside the trace.

---

## `table` — for decisions

### What it is

A weighted comparison of options across criteria. You name every option, name every criterion that matters, score each cell, and the verdict falls out of the matrix. The format forces you to do the comparison you'd otherwise skip.

### When to reach for it

- "Should I refactor or patch?"
- "Which library: X, Y, or Z?"
- "Which pattern: observer, pub-sub, or direct call?"
- "Do I add a migration or backfill?"
- Any situation where you catch yourself thinking "I'll just go with the simpler one" without having actually compared.

### How to do it

1. **Name the options.** Every realistic option, including "do nothing" and "defer." If you can't name the options, you don't understand the decision yet — go back and read the code.
2. **Name the criteria.** What actually matters for this decision? Typical criteria for a coding agent: correctness, complexity (lines changed, new dependencies), reversibility, performance, testability, team familiarity. Pick 3–5. More than 5 and you're padding. Fewer than 3 and you're pattern-matching.
3. **Score each cell.** Not a vague "good/bad." A specific claim: "adds 2 dependencies" or "breaks 3 existing tests" or "reversible with one commit." If you can't make a specific claim, write "unknown" — that's information.
4. **Weight the criteria.** Not numerically. Just name which criterion dominates if two options tie on the rest. "Correctness dominates. If both are correct, complexity decides."
5. **Write the verdict.** One sentence. Which option, which criterion decided it, what you're accepting by choosing it.

### What it catches

**Silent decisions.** You thought you were "just going with the simpler option" but the table shows the simpler option adds a dependency you don't want, or breaks a test you forgot about. The decision was made, but not by you — by pattern-matching to the first option that came to mind.

**Hidden criteria.** You compared two options on complexity but didn't ask about reversibility. The table forces you to name reversibility as a criterion, and you realize option A is a one-way door.

**False equivalence.** "Both work fine" is not a comparison. The table forces you to say *how* they differ, even if the difference is small. "Both work; A is 3 lines, B is 7 lines; A wins on complexity" is a real comparison. "Both work fine" is not.

**The 15pp failure mode.** Select-then-Solve found that CoT degrades HumanEval by 15pp because step-by-step reasoning fights code generation. The analogous failure here: you reach for a heavy comparison table on a decision that's actually obvious (which linter rule to follow), and the act of comparing introduces doubt where there was none. If the decision is genuinely obvious, the table will show it — one option dominates on every criterion — and you stop after 30 seconds.

### Effect size

- **17.1pp oracle gap** (Select-then-Solve, 2604.06753): the right reasoning structure per task is worth 17.1 percentage points over the best fixed structure, averaged across 10 benchmarks and 4 models. This is the ceiling. You won't capture all of it with a table, but the table is the mechanism that gets you part of the way there.
- **15pp degradation from wrong structure** (same paper): CoT on HumanEval. The cost of not checking whether your structure fits the task.
- **+12.7pp at 3.2× compression** (Routed Graph Handoff, 2608.25277): structured format selection over unstructured NL, on a tool-use benchmark. The structure saves tokens *and* improves accuracy.
- **14.6pp regression without routing** (same paper): forcing one format on all tasks hurts. The table format is for decisions; using it for a deterministic step is the analogous error.

### Example

```
format: table
decision: how to handle the null case in parseConfig()

| Option                    | Correctness          | Complexity       | Reversible | Testability    |
|---------------------------|----------------------|------------------|------------|----------------|
| A: throw on null          | correct, fails loud  | 1 line           | yes        | easy (expect throw) |
| B: return default         | correct, silent      | 3 lines          | yes        | easy           |
| C: skip + warn            | loses data silently  | 5 lines + logger | yes        | harder (mock logger) |
| D: do nothing (status quo)| crashes downstream   | 0                | yes        | n/a            |

dominant criterion: correctness (A and B tie; C loses)
tiebreaker: complexity (A wins: 1 line vs 3)
verdict: A. Throw on null. Accepting: callers must handle the throw,
  which means updating 3 call sites. That's the cost of failing loud.
```

---

## `pseudocode` — for plans

### What it is

The structural logic of your plan, written in code-like syntax without committing to a language. Loops, conditionals, data flow, function boundaries — but no imports, no type annotations, no framework specifics. It's the shape of the solution, not the solution itself.

### When to reach for it

- Planning a multi-step change across 2+ files
- Understanding an unfamiliar codebase's flow before modifying it
- Designing an algorithm where the logic is the hard part, not the syntax
- Any situation where you catch yourself writing code before you've thought through the order of operations

### How to do it

1. **Name the inputs and outputs.** What goes in, what comes out. If you can't name the output, you don't know what you're building.
2. **Write the top-level flow.** 3–7 lines. The major steps in order. `read → parse → transform → write`. This is the skeleton.
3. **Expand the hard steps.** The step where you're unsure gets 3–5 lines of detail. The steps you've done a hundred times stay as one-liners. Don't expand what you already know.
4. **Mark the edge cases.** `if empty: ...`, `if already exists: ...`, `on error: ...`. These are the steps you'll skip in prose and hit in production.
5. **Check for missing steps.** Read the pseudocode top to bottom. Is there a step that assumes state that hasn't been set yet? Is there a resource that's opened but not closed? Is there a step that should be reversible but isn't?

### Granularity rule

Stop at pseudocode when the next level of detail is *syntax*, not *logic*. If you're about to write `for (let i = 0; i < arr.length; i++)` instead of `for each item in arr:`, you've gone too deep. That's the implementation's job. If you're about to write "handle the error" instead of `on parse_error: log, skip, continue`, you're not deep enough.

### What it catches

**Skipped steps.** Prose says "I'll read the file, update the cache, and write it back." Pseudocode shows the loop, the skip condition, and the mutation — and you can see that you never checked whether the file exists before reading it. PGPO found that P-code plans reduce action errors and omissions specifically because the steps are *enumerated*, not described.

**Ordering bugs.** "I'll update the database and send the notification" vs "send the notification and update the database." Prose hides the order. Pseudocode makes it sequential and visible. If the notification fails, do you want the database updated or not? The pseudocode forces you to decide.

**Surface-language overfitting.** NL plans are tailored to the specific task. "Read the config file and update the port number" doesn't generalize to "read the config file and update the timeout." Pseudocode captures the structure (`read config → modify key → write config`) which generalizes across the specific key. PGPO measured this: P-code plans generalize better to unseen tasks than NL plans.

**The plan-implementation gap.** You plan in prose, implement in code, and the implementation diverges from the plan because the plan was too vague to check against. Pseudocode is specific enough to check: "did I do what the pseudocode says?" is a yes/no question. "Did I do what I planned?" is not, when the plan is "update the thing."

### Effect size

- **+4.5–5.5pp over NL plans** (PGPO, 2506.01475, ACL'25): P-code plans beat natural language plans across 4 models (Llama-2-7B/13B, Llama-3-8B, Mistral-7B) on ALFWorld, WebShop, and TextCraft. The gap is consistent, not model-specific.
- **Better out-of-distribution generalization** (same paper): on ALFWorld-Unseen, PGPO (P-code) scores 76.9 vs IPR (NL) at 74.7 on Llama-2-7B. The structure transfers; the surface language doesn't.
- **Fewer interaction turns** (same paper): P-code plans reduce average turns from 12.14 (NL) to 10.99 (P-code) on ALFWorld-seen. Fewer steps to completion because the plan is more precise.
- **Fewer action errors and omissions** (same paper, analysis section): the specific failure mode is skipped steps. The agent plans 5 steps, executes 3, and gets stuck. Pseudocode makes the 5 steps visible so the agent notices it's on step 3 of 5.
- **Eliminates the re-retrieve loop** (Skill-as-Pseudocode, 2605.27955): converting prose skill docs to typed pseudocode stops the "confused → re-retrieve → still confused" cycle. The agent gets a deterministic schema instead of re-deriving the invocation from prose each time.

### Example

```
format: pseudocode
plan: add retry with backoff to the API client

input: request (method, url, body, max_retries=3)
output: response or raised error

for attempt in 0..max_retries:
    try:
        response = send(request)
        if response.status < 500:
            return response          # 2xx, 4xx are final
    except TimeoutError:
        if attempt == max_retries - 1:
            raise                    # don't swallow the last failure
        sleep(exponential_backoff(attempt))  # 1s, 2s, 4s
    except ConnectionError:
        if attempt == max_retries - 1:
            raise
        sleep(exponential_backoff(attempt))

# edge cases:
# - 4xx is NOT retried (client error, retrying won't help)
# - 5xx IS retried (server error, may be transient)
# - timeout IS retried (same as connection error)
# - the last attempt raises, doesn't return an error response
# - backoff is exponential, not linear (avoids thundering herd)
```

---

## `trace` — for diagnosis

### What it is

A state transition walk: what was the state, what operation happened, what should the result be, what did you actually get, where did it diverge. You're not guessing. You're walking the data through the code and finding the exact line where expected ≠ actual.

### When to reach for it

- A test failed and you need to find why
- A tool returned output you didn't expect
- A bug is hard to reproduce and you need to narrow the state space
- You made a change and need to verify it didn't break something
- You're about to commit and want to check the diff does what you think

### How to do it

1. **Name the state variables.** What values matter for this bug? Not every variable — the ones in the data path from input to the wrong output. Usually 2–5. If you need more than 5, you're tracing the wrong scope.
2. **Write the state before.** The actual values, not symbols. `result = {a: 1, b: 2}`, not `result = <some object>`. If you don't know the actual value, get it: `repl`, `bash`, a log line, a test fixture. Don't guess.
3. **Write the operation.** The specific line or function that transforms the state. `result = {...result, ...updates}` at line 38. Not "the merge function" — the line.
4. **Write the expected state.** What should the state be after that operation, given the state before? Derive it. Don't copy it from the test assertion — derive it from the operation.
5. **Write the actual state.** What did you actually observe? From the test output, the log, the debugger, the tool result.
6. **Find the divergence.** Where does expected ≠ actual? Name the line, the operation, and the specific value that's wrong.
7. **Stop when expected == actual.** If the state is correct after this operation, the bug is downstream. Move to the next operation. If the state is correct at the end, the bug is upstream. Move to the previous operation. The trace terminates when you find the divergence or exhaust the data path.

### Rules

- **Actual values, not symbols.** `result.b = undefined` not `result.b = <missing>`. If you don't have the actual value, go get it before continuing the trace.
- **One operation per step.** Don't compress "read the file, parse the JSON, and update the cache" into one step. Three operations, three steps. The divergence is in one of them.
- **The last step is the fix.** Once you've found the divergence, the last line of the trace is what you're going to change. `fix: line 38 — use Object.assign(result, updates) instead of spread, which overwrites`

### What it catches

**The divergence point.** Prose says "this is probably the bug" or "I think the issue is in the merge logic." A trace says "line 38, the spread operator overwrites `b` because `updates` has its own `b` key set to `undefined`." The difference is: prose is a hypothesis, a trace is a finding. You can act on a finding. You have to test a hypothesis.

**Over-verification.** Unstructured reasoning keeps going after the answer is correct. The model generates the answer, then "verifies" it by re-deriving it, then "double-checks" by re-deriving it again. SCR found this is where the tokens go: 50% of the output length is redundant verification of an already-correct answer. The trace format has an explicit termination condition: expected == actual → stop.

**Scope creep in diagnosis.** You're tracing a null pointer and you start tracing the database connection pool. The state variables step forces you to name the 2–5 values that matter. If the database pool isn't one of them, it's not in the trace.

**The "it works on my machine" gap.** You trace the code and it looks correct. But the actual state at line 38 is different from what you assumed because of a side effect at line 20 that you didn't include in the trace. The "actual values, not symbols" rule catches this: if you write the actual value and it doesn't match what you expected the code to produce, there's an upstream side effect you missed.

### Effect size

- **50% token reduction** (SCR, 2601.07180, ICLR 2026): structured Generate-Verify-Revise reasoning produces half the output tokens of unstructured CoT on MATH500. The reduction comes from explicit termination: the model checks its answer, and if it's correct, it stops. Unstructured reasoning doesn't have a stop condition.
- **Calibrated self-verification** (same paper): base models have 92.96% recall but low precision on self-verification — they flag correct answers as wrong. SCR's explicit verify step produces higher F1. The model is better at saying "this is correct, stop" when the check is structured.
- **Generalizes beyond the training domain** (same paper): the structured verification transfers to commonsense reasoning benchmarks, not just math. The termination discipline is domain-independent.
- **Interleaved tracing beats upfront tracing** (Think Anywhere, 2603.29957): reasoning at each state-change point during code generation outperforms reasoning only at the start. The full complexity of a problem "only reveals itself during implementation." Trace as you go, not just at the end.

### Example

```
format: trace
bug: test_update_cache fails — expected {a:1, b:2, c:3}, got {a:1, c:3}

state variables: result, updates
state before (line 37):  result = {a: 1, b: 2}
operation (line 38):     result = {...result, ...updates}
  where updates = {b: undefined, c: 3}
expected after:          {a: 1, b: 2, c: 3}
  (spread should merge; b: undefined should not overwrite b: 2)
actual after:            {a: 1, c: 3}
  (b is missing — the spread DID overwrite b: 2 with b: undefined)
divergence: line 38. JS spread treats {b: undefined} as having key b.
  {...{a:1, b:2}, ...{b:undefined, c:3}} → b is undefined, not 2.
fix: filter undefined values from updates before spreading,
  or use Object.entries + filter instead of spread.
```

---

## Selection guide

| Situation | Format | Why not the others |
|---|---|---|
| Choosing between 2+ approaches | `table` | Pseudocode plans one option; trace diagnoses one path. You haven't picked a path yet. |
| Planning a multi-step change | `pseudocode` | Table compares options; you've already chosen. Trace is for after the fact. |
| Bug / failed test / unexpected output | `trace` | Table compares fixes (premature — you don't know the bug yet). Pseudocode plans (you're not planning, you're finding). |
| "Should I refactor or patch?" | `table` | It's a decision with 2 options and 3+ criteria. |
| "How do I implement this feature?" | `pseudocode` | It's a plan with multiple steps and edge cases. |
| "Why did the test fail?" | `trace` | It's a state divergence. Walk the data path. |
| "Which of these 3 APIs should I use?" | `table` | Multi-option, multi-criteria decision. |
| "What's the order of operations for this migration?" | `pseudocode` | Ordering is the hard part. Pseudocode makes sequence visible. |
| "The output is wrong but I don't know where" | `trace` | Find the divergence point before deciding on a fix. |
| Single obvious next action | *(none)* | Don't think. Act. The format is overhead when there's nothing to structure. |
| Need to run code to get a value | `repl` / `bash` | Then continue whatever format you were in. |

### Ambiguous cases

- **"I need to understand this code before I can plan."** → `trace` first (walk the data path, understand the state), then `pseudocode` (plan the change). Two think calls. Don't merge them.
- **"The bug might be in one of 3 places."** → `table` to compare the 3 hypotheses (which is most likely, what evidence supports each), then `trace` the winning hypothesis.
- **"I'm planning and I hit a decision."** → Pause the `pseudocode`, do a quick `table` for the decision, resume the `pseudocode` with the decision filled in. Three think calls. The plan is more accurate because the decision was explicit.

## Usage

Add `format:` as the first line of your `think` reasoning. The format is a structural commitment: you name it, then you follow its structure for the rest of the reasoning.

```
think(
  reasoning: "format: table\n| Option | ... |",
  kind: "decide",
  level: "medium"
)
```

```
think(
  reasoning: "format: pseudocode\nplan: add retry...\ninput: ...\nfor attempt in ...",
  kind: "plan",
  level: "high"
)
```

```
think(
  reasoning: "format: trace\nbug: test fails...\nstate before: ...\noperation: ...\nexpected: ...\nactual: ...\ndivergence: ...",
  kind: "diagnose",
  level: "high"
)
```

The `kind` and `format` are correlated but independent. You can `think` in `trace` format with `kind: verify` (trace the data path to confirm the fix works). You can `think` in `table` format with `kind: react` (a tool returned 3 possible causes; table them before picking one to trace).

## How it works

The format is a structural constraint on your reasoning output. No external tool, no execution, no model state change. You select the format, you write your reasoning in that structure, and the trace stays in your tool history where you can re-read it on the next turn.

The research backing:
- **Paradigm routing** (Select-then-Solve, 2604.06753): the right structure per task is worth 17pp. The wrong structure costs 15pp. Selection is the intervention.
- **Pseudocode planning** (PGPO, 2506.01475): structural logic beats surface language. +5pp, better generalization, fewer skipped steps.
- **Structured verification** (SCR, 2601.07180): explicit termination conditions cut tokens by 50% and calibrate self-verification.

Cost: one line in the think call (`format: X`) and the discipline of following the structure. Benefit: the reasoning is structured, auditable, matched to the task, and re-readable on the next turn.
