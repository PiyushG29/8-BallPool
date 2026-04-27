# 8 Ball Pool HTML5

This build now supports:

- Classic 8-ball rules for the original 2-player game
- A new 3-player tricolor mode with 5 red, 5 blue, 5 green, and 1 black ball
- Browser-hosted online rooms for both modes through the included Node server

## Run locally

1. Open the project folder.
2. Start the local server:

```bash
npm start
```

3. Open [http://localhost:3000](http://localhost:3000).

## Deploy to Render

This repo is ready for a single-service Render deployment.

1. Push the project to GitHub.
2. In Render, create a new Blueprint or Web Service from that repo.
3. Render can use the included `render.yaml`, or you can enter these values manually:

```text
Environment: Node
Plan: Free
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
```

After deploy, Render gives you a public `onrender.com` URL for both the game and the room server.

Important free-tier note:

- Render free web services spin down after 15 minutes of inactivity and wake on the next request, which can take around a minute.
- Active multiplayer rooms are stored in memory, so they reset if the service restarts or sleeps.

## Modes

- `Classic 2-player`: standard solids, stripes, then black ball
- `Tricolor 3-player`: player 1 clears red, player 2 clears blue, player 3 clears green, then the black ball

## Online flow

- Create a room from the `Online Rooms` panel
- Share the room code
- Start once every slot is filled

The online implementation is turn-based room sync on top of the existing pool engine, so the original table physics and shot logic stay in place.
