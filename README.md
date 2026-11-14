# Fly Mod

A fruit fly's smell circuit, taken from the real connectome, moderates Twitch chat.
Each word becomes an odor. The fly is taught 1,842 words by reward and punishment,
then rates words it has never smelled on a 1-10 scale (1 lovely, 10 foul). A
harness re-aligns those smells, and the worst (or best) smell in a message
decides the action.

**Status: trained.** On 354 held-out words (`logs/eval.log`):

| | Smell error (1-10 scale) | Good / neutral / bad accuracy | Exact action |
|---|---|---|---|
| Fly | 1.49 | 0.71 | 0.27 |
| Fly + harness curve | 1.44 | 0.72 | 0.31 |
| Always neutral | 3.00 | 0.33 | 0.16 |
| Linear model on the same odors | 1.22 | 0.83 | 0.42 |

The fly ranks good < neutral < bad well, but barely ranks bad words by severity.

## Run it

The trained fly (`trained_fly.npz`, `data/nose.npz`) is in the repo, so nothing
needs retraining. Python is managed with [uv](https://docs.astral.sh/uv/):

```bash
uv sync                      # add --extra gpu on a Linux machine with an NVIDIA GPU
npm install
npm run dev                  # the web app, with the fly moderating
```

```bash
uv run python moderate.py xqc1.txt
uv run python moderate.py --say "gg wonderful stream"
uv run python evaluate.py
```

To train again (about 12 minutes on an L40S GPU; hours on a CPU), then refresh
the harness curve and the web app's smell table:

```bash
uv run python train.py
uv run python calibrate.py
uv run python moderate.py xqc1.txt --json xqc1.fly.json
```

The first run downloads about 200 MB into `data/` (connectome, neuron labels,
word list, text model). No FlyWire token is needed. On a CPU, sniffing takes
about 0.16 s per word; on the GPU, about 0.02 s.

## How it works

| Step | What happens | Where |
|---|---|---|
| Word → odor | Text embedding → 53 numbers → firing rates of the 53 kinds of smell receptor | `flymod/nose.py` |
| Odor → brain | 200 ms of spiking simulation through 9,039 real neurons | `flymod/brain.py` |
| Brain → smell | Balance of the synaptic drive onto "avoid" vs "approach" output neurons → smell index 1-10 | `flymod/fly.py` |
| Teaching | Dopamine neurons move away from their tonic rate in proportion to the fly's error; more dopamine weakens the active synapses, less strengthens them | `flymod/fly.py` |
| Harness | Re-aligns the smells without touching the fly (below) | `flymod/harness.py` |
| Message → action | Worst word if anything stinks, else the best word if it earns a Mod Award, else the average | `flymod/moderator.py` |

| Big stink | Action |
|---|---|
| ≥ 8.75 | Ban |
| ≥ 7.5 | Mute |
| ≥ 6.5 | Timeout 30s |
| ≥ 5.5 | Slow 30s |
| ≥ 4.5 | Warn |
| ≤ 1.5 | Mod Award |

### The harness

The fly's raw smells bunch up in the middle of the scale, and chat laughter it
never met can smell foul. `flymod/harness.py` corrects that after the fly has
answered; the fly's synapses are not changed.

1. **Calibration curve.** A never-decreasing curve from what the fly says to
   what such words are labelled, fitted by `calibrate.py` on the training
   dictionary and stored in `flymod/harness.json`. It stretches both ends, so
   very good words can reach a Mod Award.
2. **Slurs.** A word the profanity list marks as a slur smells at least as bad
   as its label, and never better than Mute.
3. **Ordinary words.** Laughter ("lol", "lmao" and variants) and the words in
   `good_words.txt` / `neutral_words.txt` never smell worse than neutral.
4. **Unlisted words.** Any other word the profanity list has never heard of
   earns a Warn at most.

`moderate.py --raw` shows the fly without the harness.

### What changed to make the fly learn

The first training run (100 words, depression-only rule, spike-count readout)
learned backwards. Measured causes and fixes:

- The learning rate was about 100x too high, and with weakening as the only
  change both output pools collapsed. Dopamine now has a tonic rate and moves
  synapses both ways around it.
- Only about 18 of the 96 output neurons spike, and 11% of words make no
  approach neuron spike, so a spike-count balance was undefined or extreme.
  The balance is now read from the synaptic drive onto those neurons, which
  their spikes follow (r = 0.97).
- A Kenyon cell's effect on learning is its share of the trial's activity, so
  loud and faint odors teach equally fast.
- 100 words was too few. The dictionary is now 1,842 words.

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
- The dictionary is 190 good, 560 neutral and 300 / 160 / 300 / 32 / 300 words
  at the five bad levels (`DICTIONARY_MIX` in `flymod/words.py`).
- `trained_fly.npz` stores that dictionary, so the file contains slurs.

## Known limits

- **It over-warns.** On `xqc1.txt` the fly warns 53 of 140 messages, mostly
  for unlisted words such as emote names. The harness keeps those at Warn.
- **Severity is flat.** Held-out Ban-level words average 6.9 from the fly
  (7.2 with the curve), so bans come almost only from the harness's slur list.
- Words only: no context, no phrases, no spacing tricks.
- Mod Awards fire at ≤ 1.5 rather than the planned ≤ 1, because the fly's
  output is a noisy number that would almost never land on exactly 1.

## Fly room (3D viewer)

Run `npm install`, then `npm run dev`. Open the local URL printed by Vite.

The hackathon presentation is at `/presentation.html` (normally `http://127.0.0.1:5173/presentation.html`). Use arrow keys or Space to advance, F for fullscreen, and Home/End for the first/last slide. The Demo link opens the app in a new tab. The thirteen slides cover the title and team, the Twitch users GIF, the Twitch mod meme, the introduction to Smellcheck, why a mapped fly brain matters, the demo, four implementation walkthroughs (word-to-odor encoding, the learning circuit, moderation thresholds, and the live chat pipeline), then the results on held-out words, what the fly gets wrong and why it wears a harness, and what it means. Figures on the slides come from `logs/train.log`, `logs/eval.log`, `logs/moderate.log` and `logs/all_smells.json`. The GIF and meme image are bundled locally; [image source](https://imgflip.com/meme/291176769/WoW-Player-South-Park).

`npm run build` produces the frontend in `dist`, including the example video and chat. `npm run preview` serves that build with the local moderation API. Use `npm run dev` or `npm run preview` for moderation; a plain static file server does not provide the API.

Click Play to start the video and timestamped chat together. Drag the room to orbit, scroll to zoom, right-drag to pan, and click a workstation to focus. Add or remove flies with the buttons under the player (1–20). Each fly receives message indices matching its position in a round-robin distribution. Changing the population redistributes the visible chat across the remaining screens.

Load your own chat and video from Session. Chat accepts `[H:MM:SS] username: message` logs, including midnight rollover, or plain text (one message per second). The first timestamp is video time zero. A positive chat offset delays chat relative to video. Seeking and playback speed changes apply to both. The chat dropdown shows the messages assigned to a particular fly.

Files stay in the browser. The interface uses Three.js and Lucide icons.

## Moderation

The page is a chat viewer's view. The trained flies moderate: each message is judged as it appears, by the fly it is assigned to, and the action is applied through the local API. Chat shows what a viewer would see ("user has been timed out for 30 seconds."); warnings are private, so you only see your own. Messages you type are judged too, and a ban, mute or timeout disables your chat box. Hover a message to see its smell. Under Session, "Fly mod on" switches the flies off and Reset lifts every punishment.

Word smells for the example chat ship in `xqc1.fly.json`. Any other word (a typed message, an uploaded chat) is sniffed by `fly_server.py`, which the server starts on demand; if Python or `trained_fly.npz` is missing, those words count as neutral.

Ban and mute hide all past and future messages for that username in chat and on the flies' monitors. Timeout does the same for 30 seconds of real time, including while playback is paused. Usernames match without regard to case. Warn adds a warning badge without hiding messages. Slow 30s toggles a global per-user cooldown, measured using message timestamps, keeping at most one message per user in each 30-second interval. Message indices remain unchanged, so moderation preserves fly assignments.

Mod Award pauses video and chat and presents the selected username and message over the room, with a trophy, rays, and confetti. Resume stream dismisses the award and continues playback; the close button dismisses it while leaving playback paused. Reset clears moderation and active awards. The session is shared by all open tabs and held in server memory; restarting the local server clears it.

## Local API

All endpoints are unauthenticated, with CORS enabled for this local demo. The base URL is the server's printed URL (normally `http://127.0.0.1:5173` in development or port `4173` for preview). POST JSON with `Content-Type: application/json`.

| Endpoint | Body | Effect |
| --- | --- | --- |
| `POST /api/ban` | `{"username":"example"}` | Hide the user's messages until reset. |
| `POST /api/mute` | `{"username":"example"}` | Hide the user's messages until reset. |
| `POST /api/timeout` | `{"username":"example"}` | Hide the user's messages for 30 seconds. |
| `POST /api/warn` | `{"username":"example"}` | Increment the user's warning count. |
| `POST /api/slow` | `{"enabled":true}` | Enable the 30-second per-user cooldown; `false` disables it. |
| `POST /api/mod-award` | `{"username":"example","message":"Great message","messageId":0}` | Pause connected players and show the award. `messageId` is optional. |
| `POST /api/dismiss-award` | `{"awardId":"id from state.award.id"}` | Dismiss that award; players remain paused. |
| `POST /api/reset` | `{}` | Clear moderation and awards. |
| `POST /api/fly/smell` | `{"words":["gg","lol"]}` | Smell of each word after the harness, plus the action thresholds. `null` for a word nobody could sniff. |
| `GET /api/state` | — | Read the current session, users, slow mode, and active award. |
| `GET /api/events` | — | Subscribe to server-sent state updates, including an initial snapshot. |

Each successful POST returns the current state. External API calls affect connected browsers immediately. Awards sent without an open browser remain active and appear when the page connects. Browser-uploaded logs and videos are not sent to the API; external award requests supply the username and message explicitly.

```sh
curl -X POST http://127.0.0.1:5173/api/ban \
  -H 'Content-Type: application/json' \
  -d '{"username":"KLF_KLF"}'

curl -X POST http://127.0.0.1:5173/api/mod-award \
  -H 'Content-Type: application/json' \
  -d '{"username":"KLF_KLF","message":"JEAN WALL"}'
```

Run `npm test` for moderation behavior and HTTP/SSE integration checks.
