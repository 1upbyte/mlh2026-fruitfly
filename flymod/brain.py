"""The fly's brain: loading, the smell circuit, and the spiking simulator.

Everything here is ported from ``fly_brain_starter.py`` (sections 4-6): the same
three files, the same ``W`` matrix, the same ``find`` helper and the same
leaky integrate-and-fire maths and constants (Shiu et al. 2024). Changes:

* files are cached in ``data/`` instead of being re-downloaded every run;
* only the smell-and-learn circuit is kept (9,039 of the 139k neurons);
* three wiring corrections (see ``load_brain``), without which the circuit
  saturates and every odor looks the same;
* ``simulate`` runs many trials at once (one row per trial), so a whole
  dictionary of words can be sniffed in one pass.
"""
from __future__ import annotations

import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import scipy.sparse as sp

DATA = Path(__file__).resolve().parent.parent / "data"

# Same sources as the starter notebook.
SHIU = "https://github.com/philshiu/Drosophila_brain_model/raw/main/"
FILES = {
    "Completeness_783.csv": SHIU + "Completeness_783.csv",
    "Connectivity_783.parquet": SHIU + "Connectivity_783.parquet",
    "neuron_annotations.tsv": "https://github.com/flyconnectome/flywire_annotations/raw/main/"
                              "supplemental_files/Supplemental_file1_neuron_annotations.tsv",
}


def fetch(name: str, url: str) -> Path:
    """Download ``url`` into data/ once; later runs read the cached copy."""
    path = DATA / name
    if not path.exists():
        DATA.mkdir(exist_ok=True)
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(url, path)
    return path


@dataclass
class Brain:
    """The olfactory learning circuit cut out of the whole-brain connectome.

    ``W[i, j]`` is the signed synapse count from neuron i to neuron j
    (+ excites, - inhibits), as in the starter, restricted to the neurons in
    ``groups``. Group arrays hold row numbers into ``W``.
    """
    W: sp.csr_matrix
    root_ids: np.ndarray               # FlyWire id of every row
    groups: dict[str, np.ndarray]      # orn / pn / ln / kc / mbon / dan_pam / dan_ppl1 / ...
    glomeruli: list[str]               # the 53 odor channels, e.g. "DA1"
    orn_glom: np.ndarray               # per ORN in groups["orn"]: index into glomeruli (-1 = unlabelled)
    cell_type: np.ndarray              # annotation cell_type per row
    pam_to_mbon: np.ndarray            # synapse counts, reward dopamine neuron -> output neuron
    ppl1_to_mbon: np.ndarray           # synapse counts, punishment dopamine neuron -> output neuron

    @property
    def N(self) -> int:
        return self.W.shape[0]


def _rewire(W: sp.csr_matrix, pre: np.ndarray, post: np.ndarray | None, fn) -> sp.csr_matrix:
    """Apply ``fn`` to the weights of every pre -> post synapse (post=None: all targets)."""
    is_pre = np.zeros(W.shape[0], bool)
    is_pre[pre] = True
    is_post = np.ones(W.shape[0], bool)
    if post is not None:
        is_post[:] = False
        is_post[post] = True
    coo = W.tocoo()
    sel = is_pre[coo.row] & is_post[coo.col]
    data = coo.data.copy()
    data[sel] = fn(data[sel])
    out = sp.csr_matrix((data, (coo.row, coo.col)), shape=W.shape)
    out.eliminate_zeros()
    return out


def load_brain() -> Brain:
    # --- starter section 4: load the whole brain -------------------------------
    neurons = pd.read_csv(fetch("Completeness_783.csv", FILES["Completeness_783.csv"]), index_col=0)
    wiring = pd.read_parquet(fetch("Connectivity_783.parquet", FILES["Connectivity_783.parquet"]))
    labels = pd.read_csv(fetch("neuron_annotations.tsv", FILES["neuron_annotations.tsv"]),
                         sep="\t", low_memory=False)

    N = len(neurons)
    W = sp.csr_matrix((wiring["Excitatory x Connectivity"],
                       (wiring["Presynaptic_Index"], wiring["Postsynaptic_Index"])), shape=(N, N))
    row = {root_id: i for i, root_id in enumerate(neurons.index)}

    def find(mask):
        """Neurons matching a label filter -> their row numbers in W."""
        return np.array([row[r] for r in labels.root_id[mask] if r in row])

    # --- starter section 5: pick the neurons we care about ---------------------
    # Instead of taste/escape neurons we take the smell-and-learn pathway:
    # nose (ORN) -> antennal lobe (PN, LN) -> mushroom body (KC) -> output (MBON),
    # plus the dopamine neurons (DAN) that teach it and APL/DPM that regulate it.
    ctype = labels.cell_type.fillna("")
    whole = {
        "orn": find(labels.cell_class == "olfactory"),
        "pn": find(labels.cell_class == "ALPN"),
        "ln": find(labels.cell_class.isin(["ALLN", "ALIN", "ALON"])),
        "kc": find(labels.cell_class == "Kenyon_Cell"),
        "mbon": find(labels.cell_class == "MBON"),
        "dan_pam": find((labels.cell_class == "DAN") & ctype.str.startswith("PAM")),    # reward
        "dan_ppl1": find((labels.cell_class == "DAN") & ctype.str.startswith("PPL1")),  # punishment
        "dan_other": find((labels.cell_class == "DAN") & ~ctype.str.startswith(("PAM", "PPL1"))),
        "mbin": find(labels.cell_class == "MBIN"),                                      # APL, DPM
    }

    keep = np.unique(np.concatenate(list(whole.values())))
    local = np.full(N, -1)
    local[keep] = np.arange(len(keep))
    groups = {k: np.sort(local[v]) for k, v in whole.items()}
    W = W[keep][:, keep].tocsr().astype(np.float32)

    # Which output neurons each dopamine neuron reaches (= shares a compartment
    # with). Read before the dopamine synapses are removed below.
    pam_to_mbon = W[groups["dan_pam"]][:, groups["mbon"]].toarray()
    ppl1_to_mbon = W[groups["dan_ppl1"]][:, groups["mbon"]].toarray()

    # --- wiring corrections ------------------------------------------------------
    # The connectome's signs come from predicted neurotransmitters, and three of
    # those predictions make this circuit ignite and stay saturated (measured:
    # 77% of Kenyon cells firing for every odor, all odors >0.99 correlated).
    # In the starter's terms this is a small "lesion lab":
    dan = np.concatenate([groups["dan_pam"], groups["dan_ppl1"], groups["dan_other"]])
    # 1. Dopamine is a slow modulator, not fast excitation. Its only effect here
    #    is to gate learning (see fly.py), so its synapses carry no voltage.
    W = _rewire(W, dan, None, lambda w: w * 0)
    # 2. Kenyon cell -> Kenyon cell synapses are axon-to-axon contacts and are
    #    not known to make Kenyon cells spike; as excitation they cause runaway.
    W = _rewire(W, groups["kc"], groups["kc"], lambda w: w * 0)
    # 3. Antennal-lobe local neurons are inhibitory (GABA/glutamate); about 40%
    #    are mispredicted as excitatory.
    W = _rewire(W, groups["ln"], None, lambda w: -np.abs(w))

    root_ids = neurons.index.to_numpy()[keep]
    type_of = dict(zip(labels.root_id, ctype))
    cell_type = np.array([type_of.get(r, "") for r in root_ids])

    orn_types = cell_type[groups["orn"]]
    glomeruli = sorted({t[4:] for t in orn_types if t.startswith("ORN_")})
    gi = {g: i for i, g in enumerate(glomeruli)}
    orn_glom = np.array([gi.get(t[4:], -1) if t.startswith("ORN_") else -1 for t in orn_types])

    return Brain(W, root_ids, groups, glomeruli, orn_glom, cell_type, pam_to_mbon, ppl1_to_mbon)


# --- starter section 6: the simulator -----------------------------------------
def simulate(drive: np.ndarray, W: sp.csr_matrix, ms: float = 200, seed: int = 0) -> np.ndarray:
    """Run a batch of trials. ``drive[b, n]`` = Poisson rate (Hz) forced onto
    neuron n in trial b (0 = not driven). Returns spike counts, same shape.

    Same model and constants as the starter's ``simulate``; ``drive`` replaces
    its ``inputs=[(neurons, rate_hz), ...]`` list so each trial can have its own
    odor.
    """
    dt, v0, vth, tm, ts, ref = 0.1, -52.0, -45.0, 20.0, 5.0, 2.2
    wsyn, kick, delay = 0.275, 250 * 0.275, int(1.8 / 0.1)
    f = np.float32
    B, N = drive.shape
    rng = np.random.default_rng(seed)

    cols = np.flatnonzero(drive.any(0))                 # neurons driven in any trial
    p = (drive[:, cols] * dt / 1000).astype(f)          # spike probability per step
    driven = np.zeros((B, N), bool)
    driven[:, cols] = drive[:, cols] > 0

    v, g = np.full((B, N), v0, f), np.zeros((B, N), f)
    last = np.full((B, N), -1e9, f)
    counts = np.zeros((B, N), np.int32)
    ring = np.zeros((delay, B, N), f)
    decay = f(np.exp(-dt / ts))
    Ws = (W * wsyn).tocsr().astype(f)

    for k in range(int(ms / dt)):
        t, slot = f(k * dt), k % delay
        g += ring[slot]
        ring[slot] = 0
        free = ((t - last) > ref) | driven
        v += free * (dt * (v0 - v + g) / tm)
        g *= np.where(free, decay, f(1))
        v[:, cols] += kick * (rng.random(p.shape, dtype=f) < p)
        s = v > vth
        if s.any():
            v[s], g[s], last[s] = v0, 0, t
            counts += s
            ring[slot] += (sp.csr_matrix(s, dtype=f) @ Ws).toarray()
    return counts
