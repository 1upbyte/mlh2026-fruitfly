"""From smells to moderation: per-word smell -> per-message "big stink" -> action."""
from __future__ import annotations

import re
from dataclasses import dataclass

from .fly import NEUTRAL, Fly
from .harness import Harness
from .words import tokenize

# Each action fires when the big stink is closest to its smell index
# (Warn 5, Slow 6, Timeout 7, Mute 8, Ban 9.5), so the cut-offs are the midpoints.
PUNISHMENTS = [(8.75, "BAN"), (7.5, "MUTE"), (6.5, "TIMEOUT 30s"), (5.5, "SLOW 30s"), (4.5, "WARN")]
STINKS_FROM = PUNISHMENTS[-1][0]
# The plan says Mod Awards at smell <= 1. The fly's output is a noisy number
# clipped to 1..10, so "<= 1" would almost never fire; 1.5 means "rounds to 1".
AWARD_UP_TO = 1.5

# The same numbers, as shipped to the web app (src/fly-rules.js applies them).
THRESHOLDS = {"punishments": PUNISHMENTS, "award_up_to": AWARD_UP_TO, "neutral": NEUTRAL}

CHAT_LINE = re.compile(r"^\[(?P<time>[\d:]+)\]\s+(?P<user>[^:]+):\s?(?P<text>.*)$")


def big_stink(smells: list[float]) -> float:
    """One rotten word spoils the message. Failing that, one lovely word makes
    it; otherwise it smells like its average."""
    if not smells:
        return NEUTRAL
    worst, best = max(smells), min(smells)
    if worst >= STINKS_FROM:
        return worst
    return best if best <= AWARD_UP_TO else sum(smells) / len(smells)


def action_for(stink: float) -> str:
    for threshold, name in PUNISHMENTS:
        if stink >= threshold:
            return name
    return "MOD AWARD" if stink <= AWARD_UP_TO else "-"


@dataclass
class Verdict:
    text: str
    words: dict[str, float]   # word -> smell
    stink: float
    action: str


class Moderator:
    def __init__(self, fly: Fly, harness: Harness | None = None, raw: bool = False):
        self.fly = fly
        self.harness = None if raw else harness or Harness()   # raw: the fly's own smells
        self.known: dict[str, float] = {}   # every word is sniffed once, then remembered

    def smell_words(self, words: list[str]) -> None:
        new = sorted(set(words) - set(self.known))
        if new:
            smells = self.fly.smell(new)
            if self.harness:
                smells = self.harness.adjust(new, smells)
            self.known.update(zip(new, map(float, smells)))

    def judge(self, messages: list[str]) -> list[Verdict]:
        tokens = [tokenize(m) for m in messages]
        self.smell_words([w for t in tokens for w in t])
        verdicts = []
        for text, toks in zip(messages, tokens):
            smells = {w: self.known[w] for w in toks}
            stink = big_stink([self.known[w] for w in toks])
            verdicts.append(Verdict(text, smells, stink, action_for(stink)))
        return verdicts


def read_chat_log(path: str) -> list[tuple[str, str, str]]:
    """Lines like ``[5:12:53] user: message`` -> (time, user, message)."""
    rows = []
    for line in open(path, encoding="utf-8"):
        m = CHAT_LINE.match(line.rstrip("\n"))
        if m:
            rows.append((m["time"], m["user"], m["text"]))
    return rows
