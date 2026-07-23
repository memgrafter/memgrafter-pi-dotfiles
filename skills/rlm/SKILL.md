# RLM Scan: Depthwise Corpus Analysis

Recursive multi-agent analysis of file corpora and codebases. Each agent decides whether to recurse or terminate — arbitrary depth, no hand-designed round count.

## When to Use

- Surveying a large corpus (10K+ files) for a specific topic
- Deep-dive analysis across years/dimensions
- Any needle-in-haystack task where the answer requires touching many files
- When you want adaptive depth (the agent decides when to stop recursing)

## How It Works

```
Root (you or an agent)
├── Worker 1: writes ~/.cache/rlm-scan/<id>_round_1.md
├── Worker 2: writes ~/.cache/rlm-scan/<id>_round_2.md
└── Root synthesizes → decides: recurse deeper or stop?
    ├── If recurse: spawns Workers on subtopics
    │   └── Sub-worker writes ~/.cache/rlm-scan/<id>_round_2_<sub>.md
    └── If stop: writes final report
```

Each agent gets the SAME prompt template (below). They know they can spawn sub-agents OR terminate explicitly. The root aggregates and decides next steps.

## Setup

```bash
mkdir -p ~/.cache/rlm-scan/<project_id>
```

Results go in `~/.cache/rlm-scan/<project_id>/`. Each worker writes to a unique filename.

## Running Workers

```bash
# Kill old sessions, create fresh one
tmux kill-session -t rlm 2>/dev/null
tmux new-session -d -s rlm -c <corpus_root>

# Boot pi — poll every 3s for 'pi v' in pane
tmux send-keys -t rlm 'pi' Enter
for i in $(seq 1 30); do
  if tmux capture-pane -t rlm -p -S -2 2>/dev/null | grep -q 'pi v'; then
    break
  fi
  sleep 3
done

# Send task (paste the prompt template below)
tmux send-keys -t rlm "<TASK PROMPT>" Enter

# Wait for result — poll every 15s, timeout 10 min
for i in $(seq 1 40); do
  if [ -f ~/.cache/rlm-scan/<project_id>/<RESULT_FILE> ]; then
    break
  fi
  sleep 15
done

# Read result briefly (headings + key findings, ~80 lines)
head -80 ~/.cache/rlm-scan/<project_id>/<RESULT_FILE>

# Synthesize and decide: recurse or stop?
```

## Constraints

- **KV cache:** Only 2 slots. Use 1 worker at a time to avoid eviction latency.
- **Context:** 30k tokens. Read worker output briefly — headings and key excerpts. Don't read full files.
- **Timeouts:** Always. Never `sleep 90` or unbounded `while` loops.
- **tmux boot:** Poll every 3s. Bash and pi launch quickly.

## Prompt Template for Depth-N Agents

Copy-paste this into `tmux send-keys`. Parameters in `<>` are replaced by root.

```
RLM SCAN — Depth <N> Agent

You are analyzing a corpus at <CORPUS_ROOT> for: <TASK_DESCRIPTION>.

Context from previous rounds: read these syntheses first to avoid redundant work:
<LIST_OF_SYNTHESIS_FILES>

Your job:
1. Read the previous syntheses
2. Search the corpus for papers/files relevant to: <SUBTOPIC>
3. Read 15-20 items in depth (use `read` tool)
4. Write structured analysis to <RESULT_FILE> covering: key findings, notable papers/files with paths, what works and what fails, open questions

FORMAT: Use tables for paper/file inventories. Include arxiv IDs or filenames. Rate your confidence (high/medium/low) and justify by evidence count.

DEPTH DECISION: After analysis, decide:
- If you found subtopics worth deeper exploration, spawn a pi sub-agent:
  
  tmux kill-session -t rlm_sub 2>/dev/null
  tmux new-session -d -s rlm_sub -c <CORPUS_ROOT>
  tmux send-keys -t rlm_sub 'pi' Enter
  # poll for 'pi v' every 3s
  tmux send-keys -t rlm_sub 'YOUR DEEP-DIVE TASK PROMPT' Enter
  # wait for ~/.cache/rlm-scan/<SUB_RESULT_FILE>
  # read results, integrate into your analysis
  
- If the topic is sufficiently covered at this level, explicitly terminate:

  [TERMINATION] No further depth needed. The subtopic <X> is sufficiently covered. 
  Evidence: <N> papers analyzed, <key finding 1>, <key finding 2>. 
  Remaining questions are outside scope or require different methodology.

Write your analysis to <RESULT_FILE>. Then write a 500-word synthesis to <SYNTHESIS_FILE> covering: key findings (bullet format), what changed from previous rounds, and your depth decision (recurse with justification OR terminate with justification).
```

## Sample Termination

```
[TERMINATION] No further depth needed on "theory-practice gap."
Evidence: 19 papers analyzed. Key findings: (1) theories with practical impact identify structural properties and translate to cheap interventions; (2) existence theorems without calibration data have zero adoption; (3) the martingale proof for MAD is the most impactful theoretical result. 
Remaining questions (non-stationary convergence, sample complexity for semantic rewards) require new theoretical work, not deeper corpus analysis. A sub-agent would just re-survey the same 20 papers with marginal gains.
```

## Sample Recursion

```
[RECURSION] Found a subtopic worth deeper exploration: "KV cache protocols for agent communication."
Evidence: Q-KVComm and KV Cache Alignment appeared in rounds 1 and 9 but were not analyzed in depth. These protocols bypass text entirely — if they scale, they change the communication layer assumption across all previous rounds. Spawning sub-agent for deep-dive.

tmux kill-session -t rlm_sub 2>/dev/null
tmux new-session -d -s rlm_sub -c ~/code/analysis
tmux send-keys -t rlm_sub 'pi' Enter
# poll for 'pi v' every 3s, then:
tmux send-keys -t rlm_sub 'Deep-dive on KV cache communication protocols (Q-KVComm, KV Cache Alignment, latent space communication). Read all papers that mention KV cache, attention compression, or latent communication in multi-agent settings. Write analysis to ~/.cache/rlm-scan/corpus/kv_cache_deepdive.md and synthesis to ~/.cache/rlm-scan/corpus/kv_cache_synthesis.md.' Enter
# wait for result file, timeout 10 min
```

## Root Aggregation Pattern

After each worker completes:

1. Read the synthesis file (~500 words, quick)
2. Note: key findings, confidence rating, depth decision
3. If recursion: wait for sub-worker, read its synthesis, integrate
4. If termination: note the topic as closed
5. Revise plan based on findings — what subtopic next?
6. Continue until all planned subtopics covered OR no more useful subtopics found
7. Write final report integrating everything

## Example Flow

```
Root: "Survey ~/code/analysis for multi-agent coordination"
├── Round 1: Communication protocols [TERMINATE]
├── Round 2: Collusion & safety
│   ├── Sub: KV cache protocols [TERMINATE]
│   └── Sub: Belief manipulation [TERMINATE]
├── Round 3: Learned orchestration [TERMINATE]
├── Round 4: Credit assignment [TERMINATE]
├── Round 5: Debate & collective reasoning [TERMINATE]
├── Round 6: Large-scale emergent phenomena [TERMINATE]
├── Round 7: Evaluation & benchmarks [TERMINATE]
├── Round 8: Theory vs practice gap [TERMINATE]
├── Round 9: RLM connections [RECURSE → not needed, already deep]
└── Round 10: Final integrated report
```

## Checklist

- [ ] Created `~/.cache/rlm-scan/<project_id>/`
- [ ] Defined initial task and first subtopic
- [ ] Set up tmux session with polling
- [ ] Sent prompt template with correct parameters
- [ ] Worker wrote result + synthesis
- [ ] Read synthesis briefly
- [ ] Made depth decision (recurse or terminate)
- [ ] Revised plan based on findings
- [ ] Continued until all subtopics covered
- [ ] Wrote final report
- [ ] Killed tmux sessions
- [ ] Cleaned up or archived results