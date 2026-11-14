"""Write brain_proof.json: evidence that Smellcheck runs on the real FlyWire connectome.

    python brain_proof.py

Lists every neuron the simulation uses by its FlyWire root ID and cell type,
with the data files' checksums and the wiring counts taken from them. Anyone
can look an ID up at https://codex.flywire.ai to confirm it is a real neuron.
"""
import hashlib
import json

import numpy as np

from flymod.brain import DATA, FILES, load_brain

brain = load_brain()
g = brain.groups
W = brain.W


def block(pre, post):
    m = W[g[pre]][:, g[post]]
    return {"connected_pairs": int(m.nnz), "synapses": int(abs(m).sum())}


names = {"orn": "olfactory receptor neurons", "pn": "projection neurons", "ln": "antennal-lobe local neurons",
         "kc": "Kenyon cells", "mbon": "mushroom-body output neurons", "dan_pam": "reward dopamine neurons (PAM)",
         "dan_ppl1": "punishment dopamine neurons (PPL1)", "dan_other": "other dopamine neurons", "mbin": "APL and DPM"}
proof = {
    "project": "Smellcheck",
    "what_this_is": "The neurons and wiring the simulation runs on, taken from the FlyWire adult fruit fly connectome.",
    "verify": "Paste any root_id into https://codex.flywire.ai (dataset FAFB v783) to see that neuron.",
    "sources": {name: {"url": url, "sha256": hashlib.sha256((DATA / name).read_bytes()).hexdigest(),
                       "bytes": (DATA / name).stat().st_size} for name, url in FILES.items()},
    "circuit": {"neurons": brain.N, "connected_pairs": int(W.nnz), "synapses": int(abs(W).sum()),
                "glomeruli": brain.glomeruli},
    "pathway": {"receptor -> projection": block("orn", "pn"), "projection -> Kenyon": block("pn", "kc"),
                "Kenyon -> output (the synapses that learn)": block("kc", "mbon")},
    "groups": {key: {"what": names[key], "count": len(idx),
                     "neurons": [{"root_id": str(brain.root_ids[i]), "cell_type": str(brain.cell_type[i])} for i in idx]}
               for key, idx in g.items()},
}
with open("brain_proof.json", "w") as f:
    json.dump(proof, f, indent=1)
print(f"brain_proof.json: {brain.N} neurons, {proof['circuit']['synapses']:,} synapses")
