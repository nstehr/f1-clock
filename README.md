# f1-clock

A web application that replays historical Formula 1 races in real time, compressed into a one-hour cycle. Every hour, a random race is selected from a cache of F1 race data and played back with animated car positions on a 2D track visualization.

## How It Works

Race telemetry data is fetched from the [OpenF1 API](https://openf1.org) and cached in a local SQLite database. On each hour boundary, the server picks a random cached race and serves it to the frontend, which renders driver positions on an HTML5 Canvas overlay of the circuit. A sidebar displays a live leaderboard with position changes, pit stops, tire compounds, and race events (safety cars, flags, etc.).

Historical races (1996-2022) can be loaded separately using the tooling in the `historical/` directory, which sources data from the Ergast API.

## Requirements

- Node.js 20+
- npm

## Running Locally

```
npm install
npm start
```

The server starts on port 3000 by default. On first run, it fetches and caches race data from the OpenF1 API.

Set `PORT` to change the listen port. Set `FORCE_RACE_KEY` to lock playback to a specific OpenF1 session key for testing.

## Docker Deployment

The included Docker Compose setup runs the app behind a Traefik reverse proxy with automatic HTTPS via Let's Encrypt.

```
cp .env.example .env
```

Edit `.env` with your domain and email:

```
DOMAIN=f1clock.example.com
ACME_EMAIL=you@example.com
```

Then:

```
docker compose up -d --build
```

The SQLite cache is persisted to a `./data` volume mount. Traefik handles HTTP-to-HTTPS redirection and certificate renewal automatically.

## Project Structure

```
server/          Express server, API client, caching, data normalization
public/          Frontend (vanilla JS, HTML5 Canvas, CSS)
historical/      Tooling for loading pre-2023 race data into the cache
```

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** Vanilla JavaScript, HTML5 Canvas
- **Data:** OpenF1 API (2023+), Ergast API (pre-2023)
- **Deployment:** Docker, Traefik, Let's Encrypt
