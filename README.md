# MindTrace — Outsmart the Room

A real-time 2–8 player social deduction game.

## Rules
1. Create a room and share the six-character code.
2. At least two players join.
3. Each round has a hidden Detective and hidden Target.
4. Everyone secretly chooses one of four symbols.
5. The Detective receives three clues and guesses the Target.
6. A correct Detective guess earns 3 points. A submitted choice earns 1 point. A missed Target earns 2 bonus points.
7. Five rounds are played, then the final scoreboard appears.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` on two browser windows/devices.

## Deployment

This uses Socket.IO, so the Node server needs persistent WebSocket support. Deploy it as a Node Web Service on a host that supports WebSockets (for example Render or Railway). Start command: `npm start`.

The app is intentionally original and does not use characters, assets, or branding from any existing show.
