# Dashboard

A personal tile dashboard. Each tile shows a one-line summary and opens into a small app when clicked. On my desktop it lives full-time on its own Hyprland workspace; on my phone it's a home-screen web app I use at the gym.

One React codebase runs in both places, talking to one small FastAPI + SQLite server on my home server over Tailscale. Built as a post-graduation portfolio project.

> **Status:** the gym and finance tiles are fully working; the to-do and habit tiles are placeholders.

<!-- Screenshots: grid, gym tile and finance tile, desktop and phone.
![Dashboard grid](docs/grid.png)
![Gym tile](docs/gym.png)
![Finance tile](docs/finance.png)
![Phone](docs/phone.png)
-->

## Features

**Gym tracker**
- The tile shows the next workout day and its first exercise.
- Each training day has a pool of every exercise I can do that day. Exercises move into and out of today's workout without losing their sets, reps or last weight.
- Sets, reps and weight are editable in place, and each exercise has a one-line note ("keep a straight back next time").
- Reorder exercises, add new ones to the pool, and delete pool exercises (two clicks, so nothing disappears by accident).
- "Complete workout" advances the rotation (push → pull → legs → …).

**Monthly bills**
- The tile shows "4 of 7 paid · € 420,00 still due".
- Tick a bill off for the month; paid bills move to the bottom in the order they were ticked. Overdue bills show their due date in red.
- Add, edit and deactivate bills. Deactivated bills can be brought back.
- Payment history is kept per month, with the amount that was actually paid.

**Everywhere**
- Changes save immediately; there's no Save button.
- Every device stays in sync: the dashboard refreshes on focus, when the phone wakes up, and once a minute.
- A mobile layout with card rows, 16px inputs and large tap targets.

## Architecture

```
Desktop (Tauri app, workspace 5) ──┐
                                   ├──► FastAPI on homelab1:8010 ──► SQLite
Phone (browser, home screen) ──────┘     (Docker, Tailscale only)
                                                │
                                                └─ nightly backup ──► pulled to my PC
```

- **Frontend:** React + TypeScript, built with Vite. It's a plain web app with no Tauri-specific code, so the same build runs in both places.
- **Desktop:** a [Tauri v2](https://v2.tauri.app) window, far lighter than Electron for an app that's always open. A Hyprland window rule pins it to workspace 5.
- **Phone:** the API container also serves the built frontend, so the phone just opens `http://homelab1:8010`.
- **Backend:** FastAPI, Pydantic and plain `sqlite3`, managed with [uv](https://docs.astral.sh/uv/), running in Docker on an Ubuntu home server.
- **Network:** every device is on my [Tailscale](https://tailscale.com) tailnet, and the API only listens on the server's Tailscale address.

The server is the single source of truth. The frontend never decides what the data looks like: it asks for a change, and whatever the server returns is what gets shown.

### Repository layout

```
src/                    React frontend
├── App.tsx             Tile grid; opens and closes tiles
├── useLiveData.ts      Hook that loads a tile's data and keeps it fresh
├── GymView.tsx         Expanded gym tile
├── FinanceView.tsx     Expanded finance tile
├── money.ts            Cents ↔ text (formatting and parsing euros)
├── data.ts             The only module that talks to the API
└── App.css             All styling, including the mobile layout
src-tauri/              Tauri shell (desktop window only)
server/
├── main.py             FastAPI app: routes, CORS, serves the built frontend
├── db.py               Schema, migrations, seed data, queries
├── models.py           Pydantic models
├── backup.py           Safe database snapshot
├── Dockerfile          Node builds the frontend, Python serves everything
└── docker-compose.yml
```

## Design decisions

**Per-change endpoints, not "save the whole document".** Every action is its own small request: `PATCH` one exercise, `PUT` one payment. Two devices editing different things never overwrite each other. Editing a bill sends only the fields that changed, so even two edits to the *same* bill only collide on the same field.

**Server responses replace client state.** Every change returns the full, updated data for that tile, and the frontend shows exactly that. There is no local draft that can drift from what's stored.

**A shared tile pattern.** Each tile is a plain `{ title, preview, view }` object, so the grid handles every tile the same way, whatever its data. Its data comes from `useLiveData(load)`, which loads on open, on window focus, when the phone wakes up and every 60 seconds. The hooks live in `App`, so data survives opening and closing tiles. Adding a tile is one hook call and one array entry.

**Stale refreshes can't undo a change.** If a slow background refresh started *before* I ticked a bill, its older answer would arrive after the tick and untick it on screen. `useLiveData` keeps a counter that goes up on every refresh and every change, and a refresh only applies its result if nothing newer happened in between.

**Changes are sent one at a time.** Two quick taps could otherwise have their answers arrive out of order and show the wrong final state. `data.ts` chains changes so each waits for the previous answer; a failed change doesn't block the ones after it. Server-side version numbers would be the more general fix, but this was the smaller change for one user.

**Money is integer cents.** Everywhere, including the API, so there are no floating-point rounding errors. Parsing is done on strings (`"12,50"` → 1250), because `parseFloat("12,50")` silently gives 12. Ambiguous input like `1.234` is rejected rather than guessed.

**Bills and payments are separate tables.** A bill is the recurring thing (name, amount, due day); a payment is one row per bill per month it was paid. Payment history comes for free, and each payment stores its own amount, so raising a bill's price later doesn't rewrite past months.

**The client chooses the month.** The container runs in UTC, so in the Netherlands the server's "this month" would start an hour late (two in summer). Each device sends its own local month, like `2026-11`, and the tile rolls over to the new month by itself.

**Idempotent paid/unpaid.** Marking paid is a `PUT` and unpaid is a `DELETE` on the same URL, and doing either twice is harmless. A repeated tap or a retried request can't create a second payment or overwrite the first one's timestamp.

**Deactivate instead of delete.** Bills are never deleted, only deactivated, so their payment history stays intact and a mistake is one click to undo. Exercises in the pool *can* be deleted, but only with a two-click confirm.

**Migrations at startup.** `CREATE TABLE IF NOT EXISTS` doesn't add new columns to an existing table. So when a column is added (like the exercise note), startup checks `PRAGMA table_info` and runs `ALTER TABLE` if the column is missing. The live database on the server upgrades itself on the next deploy.

**Cache headers for the phone.** Without a caching instruction, the phone's home-screen app kept showing an old version after a deploy. `index.html` is now served with `Cache-Control: no-cache` (the browser checks with the server every time). The built JavaScript and CSS files have a content hash in their names, so they're cached forever.

**Safe SQL.** Every value goes through `?` placeholders. The one dynamic part, the `SET` clause for partial updates, only accepts column names from a fixed whitelist.

## Running it locally

### Prerequisites (Arch / Omarchy)

```bash
sudo pacman -S --needed base-devel curl wget file openssl \
  webkit2gtk-4.1 libappindicator-gtk3 librsvg nodejs npm rustup uv
rustup default stable
```

Other distributions: see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

### Run

```bash
git clone https://github.com/FrandyMK/dashboard.git
cd dashboard
npm install

# Terminal 1: the API on http://localhost:8000 (creates and seeds server/dashboard.db)
cd server
uv run fastapi dev main.py

# Terminal 2: the desktop app, pointed at the local API
VITE_API_URL=http://localhost:8000 npm run tauri dev
```

The first Tauri run compiles the Rust side and takes a few minutes. The UI hot-reloads on save, and the interactive API docs are at `http://localhost:8000/docs`.

`VITE_API_URL` is baked in at build time. For everyday use, a root `.env` (see `.env.example`) points it at the home server. Setting it in the shell, as above, overrides the file for that one run.

## Deployment

### Server (Docker)

The Dockerfile is multi-stage: a Node stage builds the frontend, and a Python stage runs the API and serves that build. The compose file stores the database in `server/data/` and binds to an address taken from `server/.env` (gitignored, machine-specific):

```bash
# server/.env on the home server
BIND_ADDRESS=<the server's Tailscale IP>
API_PORT=8010
```

Without a `.env`, it binds to `127.0.0.1:8000`, so it's never exposed by accident. Deploying an update:

```bash
cd ~/dashboard/server && git pull && docker compose up -d --build
```

### Desktop

```bash
npm run tauri build -- --no-bundle   # binary: src-tauri/target/release/dashboard
```

Hyprland 0.55+ uses Lua config. This window rule (on Omarchy, in `~/.config/hypr/input.lua`) opens the dashboard on workspace 5 without switching to it:

```lua
hl.window_rule({
  match = { class = "dashboard" },
  workspace = "5 silent",
})
```

### Phone

Open `http://homelab1:8010` in the browser and add it to the home screen.

## Backups

- `server/backup.py` uses SQLite's backup API, which makes a consistent copy even while the API is writing. It then runs `PRAGMA integrity_check` and keeps the newest 14 snapshots.
- A cron job on the server runs it nightly inside the container: `docker compose exec -T api python backup.py`.
- A systemd user timer on my PC pulls the snapshots with rsync, after boot and every morning, and keeps all of them.
- **Restore** (tested): `docker compose down`, copy a snapshot over `data/dashboard.db`, `docker compose up -d`.

## Limitations

These are known and deliberate for now:

- **No authentication.** The API is only reachable on my tailnet, and only my own devices are on it. This would need to change before giving anyone else access.
- **No offline support.** The phone needs a connection, and requests have no timeout yet, so with bad signal one hanging change holds up the ones after it.
- **Backups stay in the house** (server and PC). Off-site backup is still to do.
- **Finance shows only the current month.** The API already serves any month, but the UI can't switch yet. Marking a bill paid always records its current amount, which doesn't suit bills that vary month to month.
- **Exercises keep only their latest weight and one current note**, not a history.

## Roadmap

- [x] Desktop window pinned to a Hyprland workspace
- [x] Gym tile: exercise pool, rotation, editable sets/reps/weight, notes
- [x] Move the backend to a home server; phone version over Tailscale
- [x] Nightly backups with a tested restore
- [x] Finance tile: monthly bills and payment history
- [ ] To-do tile
- [ ] Habit tracker tile
- [ ] Finance: switch between months, custom amount when marking paid
- [ ] Workout history log and progression graphs
- [ ] Offline support for the phone, queuing changes until there's signal
- [ ] Follow the active Omarchy theme colours automatically
