"""The nose: turn a word into an odor the fly can smell.

A fly smells with 53 kinds of receptor neuron (one per glomerulus). An odor is
just "how hard each of the 53 kinds fires". So:

    word -> sentence embedding (384 numbers) -> 53 numbers -> 53 firing rates

The 384 -> 53 step is a PCA fitted once on the vocabulary WITHOUT its labels,
so the nose knows nothing about which words are good or bad. It only makes
similar words smell similar; that is what lets the fly generalise from the
100-word dictionary to words it has never been taught.
"""
from __future__ import annotations

import numpy as np

from .brain import DATA

MODEL = "BAAI/bge-small-en-v1.5"   # small ONNX text model, runs on CPU via fastembed
ODOR_HZ = 200.0                    # firing rate per unit of feature strength


class Nose:
    def __init__(self, n_glomeruli: int = 53, odor_hz: float = ODOR_HZ):
        from fastembed import TextEmbedding
        self.model = TextEmbedding(MODEL, cache_dir=str(DATA / "fastembed"))
        self.n = n_glomeruli
        self.odor_hz = odor_hz
        self._memo: dict[str, np.ndarray] = {}

        cache = DATA / "nose.npz"
        if cache.exists():
            saved = np.load(cache)
            if str(saved["model"]) == MODEL and saved["axes"].shape[0] == self.n:
                self.mean, self.axes, self.scale = saved["mean"], saved["axes"], saved["scale"]
                return
        self._fit()
        np.savez(cache, model=MODEL, mean=self.mean, axes=self.axes, scale=self.scale)

    def _fit(self) -> None:
        """Find the 53 directions along which the vocabulary varies most."""
        from .words import load_vocabulary
        E = self.embed(sorted(load_vocabulary()))      # words only, labels unused
        self.mean = E.mean(0)
        _, _, Vt = np.linalg.svd(E - self.mean, full_matrices=False)
        self.axes = Vt[: self.n]
        self.scale = ((E - self.mean) @ self.axes.T).std(0)

    def embed(self, words: list[str]) -> np.ndarray:
        new = [w for w in dict.fromkeys(words) if w not in self._memo]
        if new:
            for w, e in zip(new, self.model.embed(new)):
                self._memo[w] = np.asarray(e, np.float32)
        return np.stack([self._memo[w] for w in words])

    def features(self, words: list[str]) -> np.ndarray:
        """(len(words), 53) feature strengths, each roughly standard normal."""
        return (self.embed(words) - self.mean) @ self.axes.T / self.scale

    def smell(self, words: list[str]) -> np.ndarray:
        """(len(words), 53) receptor firing rates in Hz. A glomerulus fires in
        proportion to how strongly the word has its feature; about half are
        silent for any given word, like a real odor."""
        return (self.odor_hz * np.clip(self.features(words), 0, None)).astype(np.float32)
