"""Train the fly on its dictionary.

    python train.py                     # default: 12 epochs, saves trained_fly.npz
    python train.py --epochs 20 --lr 0.5 --seed 1

The dictionary is drawn from the labelled vocabulary (see DICTIONARY_MIX in
flymod/words.py). Every other labelled word is held
out for evaluate.py. Slurs are never printed; pass --show-dictionary to see
the words.
"""
import argparse
import time

from flymod.fly import Fly
from flymod.words import load_vocabulary, split_dictionary

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--epochs", type=int, default=12)
ap.add_argument("--lr", type=float, default=1.0, help="how much a dopamine surprise changes an active synapse")
ap.add_argument("--recovery", type=float, default=0.0, help="how fast synapses drift back to the connectome")
ap.add_argument("--seed", type=int, default=0, help="which words go in the dictionary")
ap.add_argument("--out", default="trained_fly.npz")
ap.add_argument("--show-dictionary", action="store_true")
args = ap.parse_args()

vocab = load_vocabulary()
train_words, held_out = split_dictionary(vocab, args.seed)
dictionary = {w: vocab[w] for w in train_words}
print(f"vocabulary: {len(vocab)} labelled words -> {len(dictionary)} in the dictionary, {len(held_out)} held out")
if args.show_dictionary:
    for w, s in sorted(dictionary.items(), key=lambda kv: kv[1]):
        print(f"  {s:4.1f}  {w}")

fly = Fly()
print(f"fly: {fly.brain.N} neurons, {len(fly.strength)} plastic KC->MBON synapses, "
      f"{(fly.compartment > 0).sum()} avoid / {(fly.compartment < 0).sum()} approach MBONs")

start = time.time()
fly.learn(dictionary, epochs=args.epochs, lr=args.lr, recovery=args.recovery)
fly.save(args.out)
print(f"trained in {time.time() - start:.0f}s -> {args.out}")
print("next: python evaluate.py   |   python moderate.py xqc1.txt")
