"""Let the fly moderate chat.

    python moderate.py xqc1.txt                 # replay a chat log ([h:mm:ss] user: message)
    python moderate.py --say "gg well played"   # judge one message
    python moderate.py xqc1.txt --csv out.csv   # also write every verdict to a file
    python moderate.py xqc1.txt --json xqc1.fly.json   # word smells for the web app

Every distinct word is sniffed once and passed through the harness
(flymod/harness.py). A message's big stink is its worst word if anything
stinks, else its best word if that earns a Mod Award, else the average.
"""
import argparse
import collections
import csv
import json
import os
import sys

from flymod.fly import Fly
from flymod.moderator import THRESHOLDS, Moderator, read_chat_log
from flymod.words import tokenize

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("log", nargs="?", help="chat log file")
ap.add_argument("--say", action="append", default=[], help="a single message to judge (repeatable)")
ap.add_argument("--fly", default="trained_fly.npz")
ap.add_argument("--naive", action="store_true", help="use an untrained fly (plumbing check; everything is neutral-ish)")
ap.add_argument("--limit", type=int, default=0, help="only the first N log lines")
ap.add_argument("--all", action="store_true", help="print every message, not just the ones acted on")
ap.add_argument("--raw", action="store_true", help="skip the harness: punish on the fly's own smells")
ap.add_argument("--csv", help="write all verdicts here")
ap.add_argument("--json", help="write the smell of every word here (read by the web app)")
args = ap.parse_args()
if not args.log and not args.say:
    ap.error("give a chat log or --say a message")

rows = read_chat_log(args.log) if args.log else []
if args.limit:
    rows = rows[: args.limit]
rows += [("", "you", text) for text in args.say]

fly = Fly()
if args.naive:
    fly.calibrate(sorted({w for _, _, t in rows for w in tokenize(t)})[:100] or ["hello"])
else:
    if not os.path.exists(args.fly):
        sys.exit(f"{args.fly} not found: run `python train.py` first (or pass --naive)")
    fly.load(args.fly)

mod = Moderator(fly, raw=args.raw)
verdicts = mod.judge([text for _, _, text in rows])

taught = set(fly.dictionary)
print(f"{len(rows)} messages, {len(mod.known)} distinct words sniffed "
      f"({sum(w in taught for w in mod.known)} were in the fly's dictionary)\n")
for (when, user, _), v in zip(rows, verdicts):
    if args.all or v.action != "-":
        worst = max(v.words, key=v.words.get) if v.words else ""
        print(f"[{when:>8s}] {v.action:11s} stink {v.stink:4.1f}  {user}: {v.text}"
              + (f"   (worst word: {worst!r} {v.words[worst]:.1f})" if v.action not in ("-", "MOD AWARD") else ""))

tally = collections.Counter(v.action for v in verdicts)
print("\nsummary:", ", ".join(f"{name} x{n}" for name, n in tally.most_common()))

if args.csv:
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        out = csv.writer(f)
        out.writerow(["time", "user", "message", "big_stink", "action", "word_smells"])
        for (when, user, _), v in zip(rows, verdicts):
            out.writerow([when, user, v.text, f"{v.stink:.2f}", v.action,
                          " ".join(f"{w}={s:.1f}" for w, s in v.words.items())])
    print(f"wrote {args.csv}")

if args.json:
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump({"thresholds": THRESHOLDS, "smells": {w: round(s, 2) for w, s in sorted(mod.known.items())}}, f)
    print(f"wrote {args.json}")
