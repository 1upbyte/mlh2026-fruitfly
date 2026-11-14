"""The labelled vocabulary: every word with a known smell index (1 = lovely, 10 = foul).

Bad words come from better-profane-words (intensity 1-5). The dataset is GPL-3.0
and full of slurs, so it is downloaded into data/ at runtime and never committed.
Good and neutral words come from the two small lists next to this file.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from .brain import fetch

HERE = Path(__file__).resolve().parent
PROFANE_URL = "https://raw.githubusercontent.com/awdev1/better-profane-words/main/words.json"

# Dataset intensity -> smell index. The five levels line up with the five punishments.
INTENSITY_TO_SMELL = {1: 5.0, 2: 6.0, 3: 7.0, 4: 8.0, 5: 9.5}
GOOD_SMELL, NEUTRAL_SMELL = 1.0, 3.0

# What goes into the 100-word training dictionary: smell index -> how many words.
DICTIONARY_MIX = {1.0: 20, 3.0: 20, 5.0: 12, 6.0: 12, 7.0: 12, 8.0: 12, 9.5: 12}

TOKEN = re.compile(r"[a-z0-9']+")


def tokenize(message: str) -> list[str]:
    """Chat message -> lowercase words. Emotes are just words; stretched
    letters are squeezed ("LMAOOOOO" -> "lmaoo") so spam maps to few odors."""
    return TOKEN.findall(re.sub(r"(.)\1{2,}", r"\1\1", message.lower()))


def _read_list(name: str) -> list[str]:
    lines = (HERE / name).read_text().splitlines()
    return [w.strip().lower() for w in lines if w.strip() and not w.startswith("#")]


def load_vocabulary() -> dict[str, float]:
    """word -> smell index, for every word we have a label for."""
    profane = json.loads(fetch("words.json", PROFANE_URL).read_text())
    vocab: dict[str, float] = {}
    for w in _read_list("neutral_words.txt"):
        vocab[w] = NEUTRAL_SMELL
    for w in _read_list("good_words.txt"):
        vocab[w] = GOOD_SMELL
    for entry in profane:                       # the dataset's label wins any clash
        w = entry["word"].lower().strip()
        if TOKEN.fullmatch(w):                  # single words only; phrases are skipped
            vocab[w] = INTENSITY_TO_SMELL[entry["intensity"]]
    return vocab


def split_dictionary(vocab: dict[str, float], seed: int = 0) -> tuple[list[str], list[str]]:
    """Pick the 100-word training dictionary; everything else is held out."""
    rng = np.random.default_rng(seed)
    train: list[str] = []
    for smell, n in DICTIONARY_MIX.items():
        pool = sorted(w for w, s in vocab.items() if s == smell)
        train += list(rng.choice(pool, size=n, replace=False))
    chosen = set(train)
    held_out = sorted(w for w in vocab if w not in chosen)
    return train, held_out
