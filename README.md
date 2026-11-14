# Fly Mod

A fruit fly's smell circuit, taken from the real connectome, moderates Twitch chat.
Each word becomes an odor. The fly is taught 100 words by reward and punishment,
then rates words it has never smelled on a 1-10 scale (1 lovely, 10 foul), and the
worst smell in a message decides the action.

**Status: implemented, not yet trained.** `train.py` has never been run, so its
learning-rate defaults are untuned and there are no accuracy numbers yet.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python train.py
```

```bash
.venv/bin/python evaluate.py
```

```bash
.venv/bin/python moderate.py xqc1.txt
```

The first run downloads about 200 MB into `data/` (connectome, neuron labels,
word list, text model). No FlyWire token is needed. Measured on an M-series
laptop, sniffing takes about 0.16 s per word, so one training epoch (every word
twice) is roughly 30 s and the default 20 epochs roughly 11 minutes.

## How it works

| Step | What happens | Where |
|---|---|---|
| Word → odor | Text embedding → 53 numbers → firing rates of the 53 kinds of smell receptor | `flymod/nose.py` |
| Odor → brain | 200 ms of spiking simulation through 9,039 real neurons | `flymod/brain.py` |
| Brain → smell | Balance of "avoid" vs "approach" output neurons → smell index 1-10 | `flymod/fly.py` |
| Teaching | Dopamine neurons fire in proportion to the fly's error and weaken the active synapses | `flymod/fly.py` |
| Message → action | Worst word if anything stinks, else the average | `flymod/moderator.py` |

| Big stink | Action |
|---|---|
| ≥ 8.75 | Ban |
| ≥ 7.5 | Mute |
| ≥ 6.5 | Timeout 30s |
| ≥ 5.5 | Slow 30s |
| ≥ 4.5 | Warn |
| ≤ 1.5 | Mod Award |

### What comes from the repo

- `fly_brain_starter.py`: the data files, the `W` matrix, `find`, and the
  simulator maths and constants are ported from it unchanged. The simulator was
  only extended to run many trials side by side.
- `xqc1.txt`: the chat the fly moderates in the demo. None of its words were
  harvested for training.

### The circuit

Smell receptors (2,279) → projection and local neurons (685 + 467) → Kenyon
cells (5,177) → output neurons (96), plus 331 dopamine neurons and the APL/DPM
regulators. Only the 62,261 Kenyon cell → output neuron synapses learn.

Which output neurons mean "avoid" and which mean "approach" is read from the
connectome: an output neuron wired mostly to reward dopamine (PAM) counts as
avoid, one wired mostly to punishment dopamine (PPL1) counts as approach.
Punishment weakens approach for the odor present, so it stinks next time.

### Three wiring corrections

As downloaded, the circuit saturates: 77% of Kenyon cells fire for every odor
and all odors look identical. Three edits in `load_brain` fix this, giving
about 8% of Kenyon cells per word and distinct patterns for different words:

1. Dopamine synapses carry no voltage; dopamine only gates learning.
2. Kenyon cell → Kenyon cell synapses are removed.
3. Antennal-lobe local neurons are all inhibitory.

### Labels

- Bad words: [better-profane-words](https://github.com/awdev1/better-profane-words),
  intensity 1-5 → smell 5, 6, 7, 8, 9.5. Downloaded at runtime, never committed
  (GPL-3.0, and it is a list of slurs).
- Good words (smell 1) and neutral words (smell 3): `flymod/good_words.txt` and
  `flymod/neutral_words.txt`, written for this project.
- The dictionary is 20 good, 20 neutral and 12 words at each bad level.

## Known limits

- **100 words is thin.** A plain linear model taught the same 100 words
  separates good / neutral / bad about 72% of the time on the full text
  embedding and about 60% on the 53 receptor inputs the fly actually gets, and
  it can barely rank bad words by severity. Expect the fly to be near or below
  that; `evaluate.py` prints the comparison.
- Words only: no context, no phrases, no spacing tricks.
- Mod Awards fire at ≤ 1.5 rather than the planned ≤ 1, because the fly's
  output is a noisy number that would almost never land on exactly 1.
