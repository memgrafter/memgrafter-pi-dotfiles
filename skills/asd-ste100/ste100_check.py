#!/usr/bin/env python3
"""ASD-STE100 checker — flags structural violations in text.

Checks: sentence length, passive voice, contractions, adverbs.
Does not check vocabulary (requires copyrighted word list).

Usage:
    python ste100_check.py <file>
    echo "text" | python ste100_check.py
"""
import re
import sys
from pathlib import Path

MAX_WORDS = 25

CONTRACTIONS = re.compile(
    r"\b(don't|doesn't|didn't|won't|wouldn't|shouldn't|couldn't|isn't|aren't|"
    r"wasn't|weren't|haven't|hasn't|hadn't|it's|that's|there's|here's|"
    r"who's|what's|where's|when's|why's|how's|I'm|I'll|I've|I'd|"
    r"you're|you'll|you've|you'd|we're|we'll|we've|we'd|"
    r"they're|they'll|they've|they'd|let's|that'll|there'll|he's|she's|"
    r"he'll|she'll|he'd|she'd|who'll|who'd|what'll|what'd|who've|what've|"
    r"can't|cannot|mustn't|needn't|oughtn't|'s|'re|'ve|'ll|'d|'t)\b",
    re.IGNORECASE,
)

ADVERBS = re.compile(
    r"\b(very|quite|rather|too|also|already|always|never|often|sometimes|"
    r"usually|generally|specifically|particularly|significantly|substantially|"
    r"considerably|remarkably|surprisingly|interestingly|notably|clearly|"
    r"obviously|evidently|apparently|certainly|definitely|exactly|precisely|"
    r"almost|nearly|almost|merely|simply|just|even|only|still|yet|now|"
    r"then|here|there|thus|hence|therefore|however|nevertheless|"
    r"nonetheless|moreover|furthermore|additionally|addition|meanwhile|"
    r"consequently|accordingly|deliberately|intentionally|explicitly|"
    r"implicitly|directly|indirectly|properly|correctly|incorrectly|"
    r"successfully|unsuccessfully|effectively|ineffectively|efficiently|"
    r"inefficiently|completely|partially|fully|half|mostly|mainly|"
    r"primarily|secondarily|originally|initially|finally|eventually|"
    r"immediately|instantly|quickly|rapidly|slowly|gradually|suddenly|"
    r"recently|previously|currently|presently|soon|later|before|after|"
    r"always|ever|forever|somewhere|anywhere|everywhere|nowhere)\b",
    re.IGNORECASE,
)

PASSIVE_PATTERNS = [
    # "is/are/was/were" + past participle
    (r"\b(is|are|was|were|been|being)\s+(\w+ed|\w+en)\b", lambda m: f"passive voice ('{m.group(0)}')"),
    # "get/got" + past participle
    (r"\b(get|gets|got|getting)\s+(\w+ed|\w+en)\b", lambda m: f"passive voice ('{m.group(0)}')"),
    # "by" + agent (common passive marker)
    (r"\bby\s+(the\s+)?(?:authors?|paper|this\s+work|we|us)\b", lambda m: f"passive marker ('{m.group(0)}')"),
]

# Common technical adverbs that are allowed
TECHNICAL_ADVERBS = {
    "directly", "indirectly", "explicitly", "implicitly", "centrally",
    "locally", "globally", "horizontally", "vertically", "simultaneously",
    "sequentially", "recursively", "iteratively", "asynchronously",
}


def check_line(line, lineno):
    """Check a single line for ASD-STE100 violations."""
    issues = []

    # Contractions
    for m in CONTRACTIONS.finditer(line):
        issues.append(f"line {lineno}: contraction ('{m.group(0)}')")

    # Adverbs (except technical)
    for m in ADVERBS.finditer(line):
        word = m.group(0).lower()
        if word not in TECHNICAL_ADVERBS:
            issues.append(f"line {lineno}: adverb ('{m.group(0)}')")

    # Passive voice
    for pattern, msg_fn in PASSIVE_PATTERNS:
        for m in re.finditer(pattern, line, re.IGNORECASE):
            issues.append(f"line {lineno}: {msg_fn(m)}")

    # Sentence length (check full sentences, not just lines)
    return issues


def check_sentences(text):
    """Check sentence length across full text."""
    issues = []
    # Split on sentence boundaries (period, exclamation, question)
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    for i, sentence in enumerate(sentences):
        words = sentence.split()
        if len(words) > MAX_WORDS:
            # Find approximate line number
            lineno = text[:text.find(sentence[:20])].count('\n') + 1
            issues.append(
                f"line {lineno}: {len(words)} words (max {MAX_WORDS})"
            )
    return issues


def check_file(path):
    """Check a file for ASD-STE100 violations."""
    if path == '-':
        text = sys.stdin.read()
        path = 'stdin'
    else:
        text = Path(path).read_text()

    issues = []

    # Line-level checks
    for lineno, line in enumerate(text.split('\n'), 1):
        issues.extend(check_line(line, lineno))

    # Sentence-level checks
    issues.extend(check_sentences(text))

    # Remove duplicates and sort by line number
    seen = set()
    unique = []
    for issue in issues:
        if issue not in seen:
            seen.add(issue)
            unique.append(issue)

    if unique:
        print(f"{len(unique)} violations in {path}:")
        for issue in unique:
            print(f"  {issue}")
        return 1
    else:
        print(f"No violations in {path}")
        return 0


def main():
    if len(sys.argv) < 2:
        print("Usage: ste100_check.py <file>", file=sys.stderr)
        sys.exit(1)

    sys.exit(check_file(sys.argv[1]))


if __name__ == '__main__':
    main()