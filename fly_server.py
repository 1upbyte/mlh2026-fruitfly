"""Keep a trained fly running so the web app can ask it to smell new words.

Started by server/fly.js. Protocol, one JSON value per line:
    out, once:  {"thresholds": {...}}
    in:         ["word", "another"]
    out:        {"word": 3.1, "another": 7.4}
"""
import json
import sys

from flymod.fly import Fly
from flymod.moderator import THRESHOLDS, Moderator

mod = Moderator(Fly().load(sys.argv[1] if len(sys.argv) > 1 else "trained_fly.npz"))
print(json.dumps({"thresholds": THRESHOLDS}), flush=True)
for line in sys.stdin:
    words = json.loads(line)
    mod.smell_words(words)
    print(json.dumps({w: round(mod.known[w], 2) for w in words}), flush=True)
