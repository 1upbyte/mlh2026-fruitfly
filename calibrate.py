"""Fit the harness's calibration curve (flymod/harness.json). Does not train the fly.

    python calibrate.py

The trained fly sniffs its own dictionary once; the curve maps what it says to
what those words are labelled. Held-out words are not used, so evaluate.py
stays a fair test.
"""
import argparse
import json

import numpy as np

from flymod.fly import Fly
from flymod.harness import CURVE, fit_curve
from flymod.words import load_vocabulary

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--fly", default="trained_fly.npz")
args = ap.parse_args()

vocab = load_vocabulary()
fly = Fly().load(args.fly)
said = fly.smell(fly.dictionary)
truth = np.array([vocab[w] for w in fly.dictionary])
xs, ys = fit_curve(said, truth)
CURVE.write_text(json.dumps({"fly_says": [round(x, 3) for x in xs], "means": [round(y, 3) for y in ys]}))
print(f"{len(fly.dictionary)} dictionary words -> curve with {len(xs)} corners -> {CURVE}")
for x in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10):
    print(f"  fly says {x:4.1f} -> {np.interp(x, xs, ys):4.1f}")
