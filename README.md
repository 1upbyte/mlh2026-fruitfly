# Fruit fly simulation

Run `npm install`, then `npm run dev`. Open the local URL printed by Vite.

`npm run build` produces a static site in `dist`, including the example video and chat. `npm run preview` serves that build locally.

Click Play to start the video and timestamped chat together. Drag the room to orbit, scroll to zoom, right-drag to pan, and click a workstation to focus. Add or remove flies with the buttons under the player (1–20). Each fly receives message indices matching its position in a round-robin distribution. Changing the population redistributes the visible chat across the remaining screens.

Load your own chat and video from Session. Chat accepts `[H:MM:SS] username: message` logs, including midnight rollover, or plain text (one message per second). The first timestamp is video time zero. A positive chat offset delays chat relative to video. Seeking and playback speed changes apply to both. The chat dropdown shows the messages assigned to a particular fly.

Files stay in the browser. The interface uses Three.js and Lucide icons.
