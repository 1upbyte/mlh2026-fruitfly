"""The harness: re-aligns the trained fly's smells before they become punishments.

The fly itself is not changed (no retraining). Its raw smell index is squeezed
towards the middle of the scale: almost nothing reaches Ban or Mod Award, and
chat laughter it never met in training can smell foul. Four corrections, in order:

1. Calibration: a monotonic curve from "what the fly says" to "what such words
   are actually labelled", fitted by calibrate.py on the training dictionary and
   stored in harness.json. It stretches both ends, so very good words can earn
   a Mod Award.
2. A known slur smells at least as bad as its label, and never better than Mute.
3. Laughter ("lol", "lmao" and their variants) and the ordinary words in
   good_words.txt / neutral_words.txt never smell worse than neutral.
4. Any other word the profanity list has never heard of earns a Warn at most:
   the fly alone is not trusted to time out, mute or ban over a word nobody
   has labelled.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from .brain import fetch
from .words import INTENSITY_TO_SMELL, PROFANE_URL, _read_list

CURVE = Path(__file__).resolve().parent / "harness.json"
NEUTRAL = 3.0
SLUR_FLOOR = 8.0   # Mute
UNLISTED_CAP = 5.4  # Warn
SLUR_CATEGORIES = ("slur_", "hateful_ideology")

# Matched against tokens, i.e. lowercase with stretched letters already squeezed to two.
LAUGHTER = re.compile(
    r"l+o+l+[sz]?|lo+|lel|lul[wz]?|lm+f?a+o+|rofl|kek+w?|xd+|"
    r"(?:om+e+ga|mega)?lu+l+[wz]?|a?(?:ha+)+h?|(?:he){2,}|ja(?:ja)+|pff+t?")


def fit_curve(said: np.ndarray, truth: np.ndarray) -> tuple[list[float], list[float]]:
    """Isotonic regression (pool adjacent violators): the best never-decreasing
    curve from the fly's answer to the true smell. Returns its corner points."""
    order = np.argsort(said)
    blocks = [[x, y, 1] for x, y in zip(said[order], truth[order])]   # sum x, sum y, count
    merged: list[list[float]] = []
    for block in blocks:
        merged.append(block)
        while len(merged) > 1 and merged[-2][1] / merged[-2][2] >= merged[-1][1] / merged[-1][2]:
            x, y, n = merged.pop()
            merged[-1] = [merged[-1][0] + x, merged[-1][1] + y, merged[-1][2] + n]
    return [x / n for x, _, n in merged], [y / n for _, y, n in merged]


class Harness:
    def __init__(self, curve: str | Path = CURVE):
        saved = json.loads(Path(curve).read_text()) if Path(curve).exists() else None
        self.said = np.array(saved["fly_says"]) if saved else None
        self.means = np.array(saved["means"]) if saved else None
        self._slurs: dict[str, float] | None = None
        self._profane: set[str] = set()
        self._ordinary: set[str] = set()

    def calibrate(self, smells: np.ndarray) -> np.ndarray:
        """Correction 1 only. Without a fitted curve the smells pass through."""
        smells = np.asarray(smells, float)
        return smells if self.said is None else np.interp(smells, self.said, self.means)

    def slurs(self) -> dict[str, float]:
        """Known slur -> the least it may smell."""
        if self._slurs is None:
            listed = json.loads(fetch("words.json", PROFANE_URL).read_text())
            self._profane = {entry["word"].lower().strip() for entry in listed}
            self._ordinary = set(_read_list("good_words.txt") + _read_list("neutral_words.txt")) - self._profane
            self._slurs = {
                entry["word"].lower().strip(): max(INTENSITY_TO_SMELL[entry["intensity"]], SLUR_FLOOR)
                for entry in listed
                if any(c.startswith(SLUR_CATEGORIES) for c in entry["categories"])}
        return self._slurs

    def adjust(self, words: list[str], smells: np.ndarray) -> np.ndarray:
        """All four corrections: the smell each word is punished or rewarded for."""
        out = self.calibrate(smells)
        slurs = self.slurs()
        for i, word in enumerate(words):
            if word in slurs:
                out[i] = max(out[i], slurs[word])
            elif LAUGHTER.fullmatch(word) or word in self._ordinary:
                out[i] = min(out[i], NEUTRAL)
            elif word not in self._profane:
                out[i] = min(out[i], UNLISTED_CAP)
        return out
