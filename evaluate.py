"""Score a trained fly on words it was never taught.

    python evaluate.py                  # 400 held-out words, balanced across smell levels
    python evaluate.py --n 0            # every held-out word (slow: ~2,600 sniffs)

Reports the fly next to two references trained on the same dictionary:
  * "always neutral": answers 3 for everything;
  * "ridge on odor": plain linear regression on the same 53 receptor inputs
    the fly gets. It shows how much is learnable from 100 words at all.
"""
import argparse
import os
import sys

import numpy as np

from flymod.fly import Fly
from flymod.moderator import action_for
from flymod.words import load_vocabulary

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--fly", default="trained_fly.npz")
ap.add_argument("--n", type=int, default=400, help="held-out words to test (0 = all)")
ap.add_argument("--seed", type=int, default=0)
args = ap.parse_args()

if not os.path.exists(args.fly):
    sys.exit(f"{args.fly} not found: run `python train.py` first")
vocab = load_vocabulary()
fly = Fly().load(args.fly)
taught = set(fly.dictionary)
held_out = sorted(w for w in vocab if w not in taught)

if args.n:  # same number of words from every smell level, so bad words don't swamp the score
    rng = np.random.default_rng(args.seed)
    levels = sorted(set(vocab.values()))
    per = args.n // len(levels)
    picked = []
    for s in levels:
        pool = [w for w in held_out if vocab[w] == s]
        picked += list(rng.choice(pool, size=min(per, len(pool)), replace=False))
    held_out = picked

truth = np.array([vocab[w] for w in held_out])
print(f"testing {len(held_out)} held-out words (fly was taught {len(taught)})")

# --- the three contestants -------------------------------------------------------
predictions = {"fly": fly.smell(held_out), "always neutral": np.full(len(truth), 3.0)}

X_train, y_train = fly.nose.features(fly.dictionary), np.array([vocab[w] for w in fly.dictionary])
X_test = fly.nose.features(held_out)
lam = 100.0
w = np.linalg.solve(X_train.T @ X_train + lam * np.eye(X_train.shape[1]), X_train.T @ (y_train - y_train.mean()))
predictions["ridge on odor"] = np.clip(X_test @ w + y_train.mean(), 1, 10)


# --- scoring ---------------------------------------------------------------------
def kind(smell):  # 0 good, 1 neutral, 2 bad
    return np.where(smell < 2, 0, np.where(smell < 4.5, 1, 2))


actions_true = np.array([action_for(s) for s in truth])
print(f"\n{'':16s} {'smell err':>9s} {'good/neutral/bad':>17s} {'exact action':>13s} {'ban recall':>11s} {'ban precision':>14s}")
for name, pred in predictions.items():
    acts = np.array([action_for(s) for s in pred])
    balanced = np.mean([(kind(pred)[kind(truth) == k] == k).mean() for k in range(3) if (kind(truth) == k).any()])
    should_ban, did_ban = actions_true == "BAN", acts == "BAN"
    recall = (did_ban & should_ban).sum() / max(should_ban.sum(), 1)
    precision = (did_ban & should_ban).sum() / max(did_ban.sum(), 1)
    print(f"{name:16s} {np.abs(pred - truth).mean():9.2f} {balanced:17.2f} {(acts == actions_true).mean():13.2f} "
          f"{recall:11.2f} {precision:14.2f}")

print("\nsmell err = mean absolute error on the 1-10 scale; good/neutral/bad = balanced accuracy over the three kinds")
print("\nfly's average answer per true smell level:")
for s in sorted(set(truth)):
    got = predictions["fly"][truth == s]
    print(f"  true {s:4.1f} ({action_for(s):11s})  fly says {got.mean():4.1f} +/- {got.std():.1f}   n={len(got)}")
