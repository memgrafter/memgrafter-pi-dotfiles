---
name: thinking-formats
description: Stops you from reasoning in the wrong structure. Wrong format costs 15pp on code tasks; right format is worth 17pp. Makes your decisions, plans, and diagnoses auditable in the tool trace.
---

Pick a format, think in it, commit. The format is the structure, not the content.

## Why use it

- **Prevents the 15pp failure.** Reasoning in the wrong structure actively hurts: CoT degrades code quality by 15pp. The format forces you to match structure to task before you start.
- **Makes your reasoning re-readable.** A table shows which option you picked and why. Pseudocode shows which steps you planned. A trace shows the exact line where state diverged. Freeform prose hides all three, and you can't re-read a hidden decision on the next turn.
- **Stops you when you're done.** The trace format has an explicit termination condition (expected == actual). Unstructured reasoning keeps "verifying" correct answers and wastes tokens.

## When to use

- **Choose between 2+ approaches, APIs, libraries, patterns** → `table`
- **Plan a multi-step change before writing code** → `pseudocode`
- **Diagnose a bug, react to a failed test, check unexpected tool output** → `trace`

## When NOT to use

- **Deterministic step.** `git status`, a rename, a single-line edit. Don't think at all.
- **You already know the answer.** Obvious next action, skip the think call.
- **You need to execute code.** That's `repl` or `bash`. Thinking in code *format* means writing code as reasoning, not running it.
- **You need to check a value mid-trace.** Use `repl`/`bash` to get it, then continue. Don't guess.

---

## `table` — for decisions

Name every option, name every criterion, score each cell, write the verdict.

**How:**
1. **Options.** Every realistic option, including "do nothing" and "defer."
2. **Criteria.** 3–5 that matter: correctness, complexity, reversibility, performance, testability. More than 5 is padding. Fewer than 3 is pattern-matching.
3. **Score each cell.** A specific claim: "adds 2 deps", "breaks 3 tests", "reversible with one commit." Can't claim it? Write "unknown."
4. **Dominant criterion.** Which one decides if the rest tie. "Correctness dominates; complexity breaks ties."
5. **Verdict.** One sentence: which option, which criterion decided it, what you're accepting.

**Catches:** silent decisions (you picked the first option that came to mind), hidden criteria (you didn't ask about reversibility), false equivalence ("both work fine" is not a comparison).

```
format: table
decision: how to handle null in parseConfig()

| Option                | Correctness       | Complexity | Reversible |
|-----------------------|-------------------|------------|------------|
| A: throw on null      | correct, loud     | 1 line     | yes        |
| B: return default     | correct, silent   | 3 lines    | yes        |
| C: skip + warn        | loses data        | 5 lines    | yes        |
| D: do nothing         | crashes downstream| 0          | yes        |

dominant: correctness (A,B tie; C loses)
tiebreaker: complexity (A: 1 line)
verdict: A. Accepting: 3 call sites must handle the throw.
```

---

## `pseudocode` — for plans

Structural logic in code-like syntax, no language specifics. The shape of the solution, not the solution.

**How:**
1. **Inputs/outputs.** What goes in, what comes out. Can't name the output? You don't know what you're building.
2. **Top-level flow.** 3–7 lines. `read → parse → transform → write`.
3. **Expand the hard steps.** The step you're unsure about gets 3–5 lines. Steps you've done a hundred times stay one-liners.
4. **Mark edge cases.** `if empty:`, `if exists:`, `on error:`. These are the steps you skip in prose and hit in production.
5. **Check for missing steps.** Read top to bottom. State assumed before set? Resource opened but not closed? Step that should be reversible but isn't?

**Granularity:** stop when the next level is *syntax*, not *logic*. `for each item in arr:` is pseudocode. `for (let i = 0; i < arr.length; i++)` is implementation. "Handle the error" is not deep enough. `on parse_error: log, skip, continue` is.

**Catches:** skipped steps (you planned 5, executed 3, didn't notice), ordering bugs (prose hides sequence), plan-implementation gap (prose is too vague to check against; pseudocode is a yes/no checklist).

```
format: pseudocode
plan: add retry with backoff to API client

input: request (method, url, body, max_retries=3)
output: response or raised error

for attempt in 0..max_retries:
    try:
        response = send(request)
        if response.status < 500:
            return response          # 2xx, 4xx are final
    except TimeoutError, ConnectionError:
        if attempt == max_retries - 1:
            raise                    # don't swallow last failure
        sleep(exponential_backoff(attempt))

# edge cases:
# - 4xx NOT retried (client error)
# - 5xx IS retried (transient)
# - last attempt raises, doesn't return error response
```

---

## `trace` — for diagnosis

Walk the state: before → operation → expected → actual → divergence. Not a hypothesis. A finding.

**How:**
1. **State variables.** 2–5 values in the data path from input to wrong output. More than 5 = wrong scope.
2. **State before.** Actual values, not symbols. `result = {a: 1, b: 2}`. Don't know the value? Get it via `repl`/`bash`/log. Don't guess.
3. **Operation.** The specific line. `result = {...result, ...updates}` at line 38. Not "the merge function."
4. **Expected after.** Derive it from the operation. Don't copy from the test assertion.
5. **Actual after.** From test output, log, debugger, tool result.
6. **Divergence.** Where expected ≠ actual. Name the line, the operation, the specific value.
7. **Stop when expected == actual.** Correct here → bug is downstream. Correct at end → bug is upstream.

**Rules:** actual values not symbols. One operation per step. Last line is the fix.

**Catches:** the divergence point (prose says "probably the bug," trace says "line 38, spread overwrites b"), over-verification (explicit stop condition: expected == actual → done), scope creep (state variables step bounds the trace).

```
format: trace
bug: test_update_cache — expected {a:1,b:2,c:3}, got {a:1,c:3}

state vars: result, updates
before (L37):  result = {a:1, b:2}
op (L38):      result = {...result, ...updates}   # updates = {b:undefined, c:3}
expected:      {a:1, b:2, c:3}
actual:        {a:1, c:3}
divergence: L38. Spread treats {b:undefined} as key b present.
fix: filter undefined values from updates before spreading.
```

---

## Selection guide

| Situation | Format |
|---|---|
| Choosing between 2+ approaches | `table` |
| Planning a multi-step change | `pseudocode` |
| Bug / failed test / unexpected output | `trace` |
| "Should I refactor or patch?" | `table` |
| "How do I implement this?" | `pseudocode` |
| "Why did the test fail?" | `trace` |
| Single obvious next action | *(none — act)* |
| Need to run code | `repl` / `bash` |

**Ambiguous:**
- "Understand before I plan" → `trace` then `pseudocode`. Two calls.
- "Bug might be in 3 places" → `table` the hypotheses, then `trace` the winner.
- "Planning and I hit a decision" → pause `pseudocode`, quick `table`, resume.

## Usage

`format:` is the first line of `think` reasoning. It's a structural commitment.

```
think(reasoning: "format: table\n| Option | ... |", kind: "decide", level: "medium")
think(reasoning: "format: pseudocode\nplan: ...\ninput: ...\nfor ...", kind: "plan", level: "high")
think(reasoning: "format: trace\nbug: ...\nbefore: ...\nop: ...\ndivergence: ...", kind: "diagnose", level: "high")
```

`kind` and `format` are independent. `trace` format with `kind: verify` (confirm the fix). `table` format with `kind: react` (tool returned 3 possible causes; table them before tracing one).

## Output

`Success.` The reasoning text stays in your tool history where you can re-read it on the next turn. No state change, no side effects.

Cost: one line in the think call (`format: X`) and the discipline of following the structure. Benefit: reasoning that's structured, auditable, matched to the task, and re-readable.
