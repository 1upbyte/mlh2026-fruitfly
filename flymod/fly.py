"""The fly: sniffs words, reports how bad they smell, and learns from dopamine.

How a real fly learns smells, and what this file copies:

* An odor lights up a sparse set of Kenyon cells (KC).
* Kenyon cells excite mushroom-body output neurons (MBON). Some MBONs push the
  fly to APPROACH, others to AVOID. The balance is how the odor "feels".
* Punishment fires PPL1 dopamine neurons; reward fires PAM dopamine neurons.
  Dopamine above its tonic level while a Kenyon cell is active WEAKENS that
  cell's synapse onto the MBONs in the dopamine neuron's compartment; a dip
  below the tonic level STRENGTHENS it.
* PPL1 sits with approach MBONs, PAM with avoid MBONs. So punishment (PPL1 up,
  PAM down) weakens "approach" and strengthens "avoid" for that odor: it now
  stinks. Reward does the opposite.

The only thing that changes during training is the strength of the
KC -> MBON synapses. Everything else is the fixed connectome.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import scipy.sparse as sp

from .brain import GPU, Brain, load_brain, simulate
from .nose import Nose

NEUTRAL = 3.0        # smell index of an odor the fly has no opinion about
V_SPAN = 0.3         # MBON balance that counts as the extreme of the scale (tuned; see README)
TONIC_HZ = 50.0      # dopamine neuron firing rate when the fly's reaction is exactly right
LESSON = 128         # words taught between synapse updates
MAX_STRENGTH = 2.0   # a synapse can grow to at most twice its mapped size
# Trials simulated side by side. CPU: measured ~0.16 s per word at 16; 100 is 4x slower per word.
BATCH = 256 if GPU else 16


def smell_to_balance(smell: np.ndarray) -> np.ndarray:
    """Smell index 1..10 -> target avoid/approach balance. 3 is indifference."""
    smell = np.asarray(smell, float)
    span = np.where(smell >= NEUTRAL, 10 - NEUTRAL, NEUTRAL - 1)
    return (smell - NEUTRAL) / span * V_SPAN


def balance_to_smell(balance: np.ndarray) -> np.ndarray:
    """Avoid/approach balance -> smell index, clipped to 1..10."""
    span = np.where(balance >= 0, 10 - NEUTRAL, NEUTRAL - 1)
    return np.clip(NEUTRAL + balance / V_SPAN * span, 1, 10)


class Fly:
    def __init__(self, brain: Brain | None = None, nose: Nose | None = None):
        self.brain = brain or load_brain()
        self.nose = nose or Nose(len(self.brain.glomeruli))
        g = self.brain.groups

        # The plastic synapses: every KC -> MBON contact, with a learned
        # strength multiplier that starts at 1 (= the connectome as mapped).
        block = self.brain.W[g["kc"]][:, g["mbon"]].tocoo()
        self.syn_kc, self.syn_mbon = block.row, block.col   # positions within the kc / mbon groups
        self._syn_weight = block.data
        self.strength = np.ones(len(block.data), np.float32)

        # Everything that is not a KC -> MBON synapse never changes.
        coo = self.brain.W.tocoo()
        is_kc = np.zeros(self.brain.N, bool)
        is_mbon = np.zeros(self.brain.N, bool)
        is_kc[g["kc"]] = True
        is_mbon[g["mbon"]] = True
        fixed = ~(is_kc[coo.row] & is_mbon[coo.col])
        self._W_fixed = sp.csr_matrix((coo.data[fixed], (coo.row[fixed], coo.col[fixed])),
                                      shape=self.brain.W.shape)

        # Compartments, read from the connectome: an MBON that hears mostly from
        # reward dopamine (PAM) drives avoidance (+1); one that hears mostly from
        # punishment dopamine (PPL1) drives approach (-1). 0 = no dopamine input.
        pam, ppl1 = self.brain.pam_to_mbon.sum(0), self.brain.ppl1_to_mbon.sum(0)
        total = pam + ppl1
        self.compartment = np.where(total > 0, (pam - ppl1) / np.maximum(total, 1), 0.0)
        # How much each dopamine neuron contributes to the dopamine felt at each MBON.
        reach = np.vstack([self.brain.pam_to_mbon, self.brain.ppl1_to_mbon])
        self._dopamine_reach = reach / np.maximum(reach.sum(0), 1)
        self._dan = np.concatenate([g["dan_pam"], g["dan_ppl1"]])

        self.naive: np.ndarray | None = None   # [avoid, approach] activity before any learning
        self.dictionary: list[str] = []        # words the fly was taught

    # ------------------------------------------------------------------ sensing
    def wiring(self) -> sp.csr_matrix:
        """The connectome with the learned KC -> MBON strengths applied."""
        g = self.brain.groups
        plastic = sp.csr_matrix((self._syn_weight * self.strength,
                                 (g["kc"][self.syn_kc], g["mbon"][self.syn_mbon])),
                                shape=self.brain.W.shape)
        return (self._W_fixed + plastic).tocsr()

    def sniff(self, words: list[str], reward: np.ndarray | None = None,
              punish: np.ndarray | None = None, seed: int = 0, ms: float = 200) -> np.ndarray:
        """Present each word as an odor for ``ms`` of brain time. Optionally fire
        the reward (PAM) / punishment (PPL1) dopamine neurons at the given rate
        per word (Hz). Returns spike counts, (len(words), n_neurons)."""
        g, br = self.brain.groups, self.brain
        labelled = br.orn_glom >= 0
        W = self.wiring()
        out = []
        for start in range(0, len(words), BATCH):
            chunk = slice(start, start + BATCH)
            odor = self.nose.smell(words[chunk])
            drive = np.zeros((len(odor), br.N), np.float32)
            drive[:, g["orn"][labelled]] = odor[:, br.orn_glom[labelled]]
            if reward is not None:
                drive[:, g["dan_pam"]] = reward[chunk, None]
            if punish is not None:
                drive[:, g["dan_ppl1"]] = punish[chunk, None]
            out.append(simulate(drive, W, ms=ms, seed=seed + start))
        return np.concatenate(out)

    def pools(self, counts: np.ndarray) -> np.ndarray:
        """Spike counts -> (trials, 2): synaptic drive from the Kenyon cells onto
        the avoid MBONs and onto the approach MBONs.

        The drive (Kenyon cell spikes x synapse count x learned strength) is
        what depolarises an MBON. It is read instead of the MBON's own spike
        count because spiking is thresholded: only about 18 of the 96 MBONs
        fire at all and 11% of words make no approach MBON fire, which leaves
        nothing to compare. Measured, MBON spikes follow this drive (r = 0.97).
        """
        g = self.brain.groups
        synapses = sp.csr_matrix((self._syn_weight * self.strength, (self.syn_kc, self.syn_mbon)),
                                 shape=(len(g["kc"]), len(g["mbon"])))
        drive = counts[:, g["kc"]].astype(np.float32) @ synapses
        return np.stack([drive @ np.clip(self.compartment, 0, None),
                         drive @ np.clip(-self.compartment, 0, None)], axis=1)

    def calibrate(self, words: list[str]) -> None:
        """Record how strongly each MBON pool is driven before learning, so that
        an untrained fly is on average indifferent (smell index 3)."""
        self.naive = self.pools(self.sniff(words)).mean(0)
        if (self.naive <= 0).any():
            raise RuntimeError(f"an MBON pool gets no drive for these odors (avoid, approach = "
                               f"{self.naive}); raise ODOR_HZ in nose.py or the sniff duration")

    def balance(self, counts: np.ndarray) -> np.ndarray:
        """-1 (pure approach) .. +1 (pure avoid); 0 if the Kenyon cells stay silent."""
        if self.naive is None:
            raise RuntimeError("calibrate() or load() the fly first")
        avoid, approach = (self.pools(counts) / self.naive).T
        return (avoid - approach) / np.maximum(avoid + approach, 1e-6)

    def smell(self, words: list[str], seed: int = 0) -> np.ndarray:
        """The fly's own smell index (1..10) for each word."""
        return balance_to_smell(self.balance(self.sniff(words, seed=seed)))

    # ----------------------------------------------------------------- learning
    def learn(self, dictionary: dict[str, float], epochs: int = 12, lr: float = 1.0,
              recovery: float = 0.0, log=print, first_epoch: int = 0) -> list[float]:
        """Teach the fly a {word: smell index} dictionary.

        Words are taught in shuffled lessons of LESSON words; the synapses
        change after each lesson. Within a lesson every word is presented twice:
          1. alone, and the fly's reaction is read off its MBONs;
          2. again, with the dopamine neurons shifted away from their tonic
             rate in proportion to how wrong that reaction was.
             Under-reacted to a foul word -> punishment: PPL1 up, PAM down.
             Over-reacted to a fine word  -> reward:     PAM up, PPL1 down.
        Returns each epoch's mean absolute smell error on those first sniffs.
        """
        words = list(dictionary)
        target = smell_to_balance(np.array([dictionary[w] for w in words]))
        target_smell = np.array([dictionary[w] for w in words])
        if self.naive is None:
            self.calibrate(words)
        self.dictionary = words

        history = []
        for epoch in range(first_epoch, first_epoch + epochs):
            order = np.random.default_rng(epoch).permutation(len(words))
            errors = []
            for n, start in enumerate(range(0, len(words), LESSON)):
                pick = order[start:start + LESSON]
                lesson = [words[i] for i in pick]
                seed = 1000 * epoch + 2 * n
                reaction = self.balance(self.sniff(lesson, seed=seed))
                error = np.clip(target[pick] - reaction, -1, 1)
                errors.append(np.abs(balance_to_smell(reaction) - target_smell[pick]))
                counts = self.sniff(lesson, reward=TONIC_HZ * (1 - error), punish=TONIC_HZ * (1 + error),
                                    seed=seed + 1)
                self.reinforce(counts, lr, recovery)
            history.append(float(np.concatenate(errors).mean()))
            log(f"epoch {epoch + 1:3d}/{first_epoch + epochs}  dictionary smell error {history[-1]:.2f}  "
                f"mean synapse strength {self.strength.mean():.3f}")
        return history

    def reinforce(self, counts: np.ndarray, lr: float, recovery: float, ms: float = 200) -> None:
        """The three-factor rule, applied to every KC -> MBON synapse:

            change = - lr * KC * (dopamine - tonic)        # more dopamine than usual: weaken;
                                                           # less than usual: strengthen
                     + recovery * KC * (1 - strength)      # optional drift back to the connectome

        ``KC`` is the Kenyon cell's share of all Kenyon cell spikes in a trial
        (so loud and faint odors teach equally fast), ``dopamine`` the
        spike count of the dopamine neurons that reach the synapse's MBON and
        ``tonic`` what that count is when the fly has nothing to learn.
        """
        g = self.brain.groups
        kc = counts[:, g["kc"]].astype(np.float32)                              # trials x KC
        kc /= np.maximum(kc.sum(1, keepdims=True), 1)
        dopamine = counts[:, self._dan].astype(np.float32) @ self._dopamine_reach  # trials x MBON
        surprise = dopamine - TONIC_HZ * ms / 1000 * self._dopamine_reach.sum(0)
        paired = (kc.T @ surprise)[self.syn_kc, self.syn_mbon]
        alone = kc.sum(0)[self.syn_kc]
        self.strength = np.clip(self.strength + recovery * alone * (1 - self.strength) - lr * paired,
                                0, MAX_STRENGTH).astype(np.float32)

    # -------------------------------------------------------------- persistence
    def save(self, path: str | Path) -> None:
        np.savez(path, strength=self.strength, naive=self.naive, dictionary=np.array(self.dictionary),
                 syn_kc=self.syn_kc, syn_mbon=self.syn_mbon)

    def load(self, path: str | Path) -> "Fly":
        saved = np.load(path)
        if not (np.array_equal(saved["syn_kc"], self.syn_kc) and np.array_equal(saved["syn_mbon"], self.syn_mbon)):
            raise ValueError(f"{path} was trained on a different connectome")
        self.strength, self.naive = saved["strength"], saved["naive"]
        self.dictionary = [str(w) for w in saved["dictionary"]]
        return self
