# ASD-STE100 — Simplified Technical English

Rules and checker from ASD-STE100 Issue 9 (2025-01-15).

## When to use this skill

- Generate user-facing content (digests, reports, documentation)
- Check existing text for clarity violations
- Add to agent system prompts for enforced output style

## Core rules (from standard)

### Section 1 — Words
| Rule | Text |
|---|---|
| 1.1 | Use words that are: approved in the dictionary, technical nouns, technical verbs |
| 1.2 | Use approved words only as the specified part of speech |
| 1.3 | Use approved words only with their approved meanings |
| 1.4 | Use only the approved forms of verbs and adjectives |
| 1.5-1.6 | Technical nouns: use only words from your company/industry glossary |
| 1.7 | Do not use technical nouns as verbs |
| 1.10 | Do not use regional, slang, or jargon words as technical nouns |
| 1.11 | Do not use different technical nouns for the same item |
| 1.12-1.13 | Technical verbs: use only specified categories; do not use as nouns |
| 1.14 | Use American English spelling |

### Section 2 — Verbs
| Rule | Text |
|---|---|
| 2.1 | Write multi-word nouns of no more than three words |

### Section 3 — Verbs (forms)
| Rule | Text |
|---|---|
| 3.1 | Use only the verb forms that are given in the dictionary |
| 3.2 | Use only: infinitive form, imperative form, simple past tense, past participle |
| 3.3 | Use the past participle form as an adjective |
| 3.4 | Do not use auxiliary verbs to make complex verb constructions |
| 3.5 | Use the "-ing" form of a verb only as a technical noun or modifier in a technical noun |
| 3.6 | Use the active voice |
| 3.7 | Use an approved verb to describe an action, not a noun or other parts of speech |

### Section 4 — Sentences
| Rule | Text |
|---|---|
| 4.1 | Write short and clear sentences |
| 4.2 | Do not omit words or use contractions to make your sentences shorter |
| 4.3 | Use a vertical list for complex texts |
| 4.4 | Use connecting words and connecting phrases to connect sentences that contain related topics |

### Section 5 — Instructions
| Rule | Text |
|---|---|
| 5.1 | Write short sentences |
| 5.2 | Write only one instruction in each sentence unless two or more actions occur at the same time |
| 5.3 | Write instructions in the imperative (command) form |
| 5.5 | Write notes only to give information, not instructions |

### Section 6 — Text organization
| Rule | Text |
|---|---|
| 6.1 | Give information gradually |
| 6.2 | Use key words and key phrases to give your text a logical structure |
| 6.3 | Write short sentences |
| 6.4 | Use paragraphs to show related information |
| 6.5 | Make sure that each paragraph has only one topic |
| 6.6 | Make sure that no paragraph has more than six sentences |

### Section 7 — Safety
| Rule | Text |
|---|---|
| 7.1 | Use an applicable word to identify the level of risk |
| 7.2 | Start a safety instruction with a clear and accurate command or condition |
| 7.3 | Give an explanation to show the risk or possible result |

### Section 8 — Symbols and numbers
| Rule | Text |
|---|---|
| 8.1 | You can use all standard English punctuation marks but not the semicolon (;) |
| 8.2 | Use hyphens (-) to connect words that are directly related |
| 8.3 | You can use parentheses: to make references to illustrations or text, to include letters or numbers that identify items, to identify work steps in a procedure, to include abbreviations, to give singular and plural forms at the same time, to explain words or a part of a sentence |
| 8.6 | Count each of these elements as one word: numbers, numbers together with units of measurement |

### Section 9 — Word-for-word replacement
| Rule | Text |
|---|---|
| 9.1 | Use a different sentence construction when a word-for-word replacement is not possible |
| 9.2 | Use each approved word correctly |

## Prompt enforcement

Add to system prompts:

```
Write in Simplified Technical English (ASD-STE100).
- Use only approved words. Do not use words with multiple meanings.
- Use the active voice. Do not use passive voice.
- Write short sentences. Maximum 25 words per sentence.
- Write only one idea in each sentence.
- Do not use contractions.
- Do not use auxiliary verbs to make complex verb constructions.
- Use the imperative form for instructions.
- Do not use semicolons.
- Do not use adverbs except when the meaning is technical.
```

## Python checker

Use `ste100 check <file>` to flag violations.

```bash
ste100 check /path/to/text.md
```

Checks: sentence length (rule 4.1, 5.1, 6.3), passive voice (rule 3.6), contractions (rule 4.2), adverbs (rule 1.1).

Does not check: approved word list (requires copyrighted dictionary).

## Common LLM violations

| Non-STE | STE |
|---|---|
| "demonstrates that" | "shows that" |
| "comprehensive" | "complete" or "full" |
| "significantly" | remove the adverb |
| "it is worth noting" | remove |
| "there is/are" | use active subject |
| "which is characterized by" | use active verb |
| em-dashes and parentheses for non-essential info | use a separate sentence |
| "i.e.", "e.g.", "etc." | use approved alternatives |
| contractions | expand |
| passive voice | rewrite with active voice |