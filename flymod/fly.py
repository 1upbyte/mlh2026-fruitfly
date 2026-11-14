"""The fly: sniffs words, reports how bad they smell, and learns from dopamine.

How a real fly learns smells, and what this file copies:

* An odor lights up a sparse set of Kenyon cells (KC).
* Kenyon cells excite mushroom-body output neurons (MBON). Some MBONs push the
  fly to APPROACH, others to AVOID. The balance is how the odor "feels".
* Punishment fires PPL1 dopamine neurons; reward fires PAM dopamine neurons.
  Dopamine arriving while a Kenyon cell is active WEAKENS that cell's synapse
  onto the MBONs in the dopamine neuron's compartment.
* PPL1 sits with approach MBONs, PAM with avoid MBONs. So punishment weakens
  "approach" for that odor (it now stinks) and reward weakens "avoid".

The only thing that changes during training is the strength of the
KC -> MBON synapses. Everything else is the fixed connectome.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import scipy.sparse as sp

from .brain import Brain, load_brain, simulate
from .nose import Nose

NEUTRAL = 3.0        # smell index of an odor the fly has no opinion about
V_SPAN = 0.8         # MBON balance that counts as the extreme of the scale
DOPAMINE_HZ = 100.0  # dopamine neuron firing rate for a maximal reward/punishment
BATCH = 16           # trials simulated side by side (measured: ~0.16 s per word; 100 is 4x slower per word)


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
        """Spike counts -> (trials, 2): total avoid-MBON and approach-MBON activity."""
        mbon = counts[:, self.brain.groups["mbon"]].astype(float)
        return np.stack([mbon @ np.clip(self.compartment, 0, None),
                         mbon @ np.clip(-self.compartment, 0, None)], axis=1)

    def calibrate(self, words: list[str]) -> None:
        """Record how active each MBON pool is before learning, so that an
        untrained fly is indifferent (smell index 3) to everything."""
        self.naive = self.pools(self.sniff(words)).mean(0)
        if (self.naive <= 0).any():
            raise RuntimeError(f"an MBON pool is silent for these odors (avoid, approach = "
                               f"{self.naive}); raise ODOR_HZ in nose.py or the sniff duration")

    def balance(self, counts: np.ndarray) -> np.ndarray:
        """-1 (pure approach) .. +1 (pure avoid); 0 if the MBONs stay silent."""
        if self.naive is None:
            raise RuntimeError("calibrate() or load() the fly first")
        avoid, approach = (self.pools(counts) / self.naive).T
        return (avoid - approach) / np.maximum(avoid + approach, 1e-6)

    def smell(self, words: list[str], seed: int = 0) -> np.ndarray:
        """The fly's own smell index (1..10) for each word."""
        return balance_to_smell(self.balance(self.sniff(words, seed=seed)))

    # ----------------------------------------------------------------- learning
    def learn(self, dictionary: dict[str, float], epochs: int = 20, lr: float = 0.002,
              recovery: float = 0.0005, log=print) -> list[float]:
        """Teach the fly a {word: smell index} dictionary.

        Each epoch every word is presented twice:
          1. alone, and the fly's reaction is read off its MBONs;
          2. again, with dopamine in proportion to how wrong that reaction was.
             Under-reacted to a foul word -> punishment (PPL1).
             Over-reacted to a fine word  -> reward (PAM).
        Returns the mean absolute smell error after each epoch's first sniff.
        """
        words = list(dictionary)
        target = smell_to_balance(np.array([dictionary[w] for w in words]))
        target_smell = np.array([dictionary[w] for w in words])
        if self.naive is None:
            self.calibrate(words)
        self.dictionary = words

        history = []
        for epoch in range(epochs):
            reaction = self.balance(self.sniff(words, seed=1000 * epoch))
            error = target - reaction
            mae = float(np.abs(balance_to_smell(reaction) - target_smell).mean())
            history.append(mae)
            log(f"epoch {epoch + 1:3d}/{epochs}  dictionary smell error {mae:.2f}  "
                f"mean synapse strength {self.strength.mean():.3f}")

            counts = self.sniff(words,
                                reward=DOPAMINE_HZ * np.clip(-error, 0, 1),
                                punish=DOPAMINE_HZ * np.clip(error, 0, 1),
                                seed=1000 * epoch + 500)
            self.reinforce(counts, lr, recovery)
        return history

    def reinforce(self, counts: np.ndarray, lr: float, recovery: float) -> None:
        """The three-factor rule, applied to every KC -> MBON synapse:

            change = recovery * KC * (1 - strength)   # KC active alone: drift back up
                     - lr * KC * dopamine             # KC active with dopamine: weaken

        ``KC`` is the Kenyon cell's spike count in a trial and ``dopamine`` is the
        spike count of the dopamine neurons that reach the synapse's MBON.
        """
        g = self.brain.groups
        kc = counts[:, g["kc"]].astype(np.float32)                              # trials x KC
        dopamine = counts[:, self._dan].astype(np.float32) @ self._dopamine_reach  # trials x MBON
        paired = (kc.T @ dopamine)[self.syn_kc, self.syn_mbon]
        alone = kc.sum(0)[self.syn_kc]
        self.strength = np.clip(self.strength + recovery * alone * (1 - self.strength) - lr * paired,
                                0, 1).astype(np.float32)

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
