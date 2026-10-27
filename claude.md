# Dashboard project — handoff summary

Context for continuing this project in a new chat. Written at the end of the previous chat (October 2026).

**Repository:** https://github.com/FrandyMK/dashboard (public, branch `master`)

**Next step:** the Finance tile — tracking monthly payments and whether each one has been paid this month. See the last section.

---

## About me and how I like to work

- I'm Frandy. I recently finished an AI bachelor, and this is a portfolio project, so I want to understand and be able to explain every decision, not just have working code.
- I write the code myself with guidance. Explain the concept behind each step, briefly, after the code.
- I'm newer to frontend, Rust, Docker and Linux config, so give exact commands and file paths, and say which machine a command runs on (my PC or the homelab).
- One step at a time, test it, commit, then move on. I sometimes dictate messages by voice, so they can be a bit loose.
- When I paste an error or screenshot, diagnose first before handing me a fix.

## Machines and environment

| Machine | Details |
|---|---|
| PC (development) | Omarchy (Arch Linux + Hyprland 0.55+). Editor: LazyVim (nvim). Terminal: foot. Browser: Chromium. |
| Homelab | Ubuntu with Docker. Tailscale hostname: `homelab1`. Repo cloned at `~/dashboard`. |
| Phone | Uses the dashboard in the browser, added to the home screen. |

All three are connected via **Tailscale**. The API is only reachable over the tailnet.

**Important environment quirks:**
- Hyprland 0.55+ and Omarchy 4 use **Lua config** (`~/.config/hypr/*.lua`), not the old `hyprland.conf` syntax. Omarchy changes fast, so check current docs or my actual files before giving config advice.
- Omarchy doesn't ship `nano`. I use nvim.
- My `ls` hides dotfiles; use `ls -a`.
- There was once a stray `~/pyproject.toml` and `~/uv.lock` in my home folder that made uv treat every project as part of one workspace. It's been deleted, but if uv ever behaves strangely (no `.venv` or `uv.lock` in the project folder), check for that first.
- `uv init` on my version created a `src/` package layout; `uv init --bare` is what worked.

## What exists now

A personal tile dashboard. Each tile shows a summary and opens into a small app when clicked. **The gym tile is fully working; to-do, finance and habits tiles are placeholders.**

It runs in two places from one React codebase:
- **Desktop:** a Tauri app pinned to Hyprland workspace 5.
- **Phone:** the same frontend, built and served by the API container on the homelab, at `http://homelab1:8010`.

### Architecture

```
Desktop (Tauri app, workspace 5) ──┐
                                   ├──► FastAPI on homelab1:8010 ──► SQLite (server/data/dashboard.db)
Phone (browser, home screen) ──────┘         (Docker, Tailscale only)
                                                    │
                                                    └─ nightly backup ──► pulled to PC
```

The server is the single source of truth. The frontend never decides what the data looks like: it asks for a change, and whatever the server returns is shown.

### Repository layout

```
dashboard/
├── src/                      React + TypeScript frontend (pure web, no Tauri-specific code)
│   ├── App.tsx               Tile grid, opens/closes tiles, loads and refreshes the gym plan
│   ├── GymView.tsx           Expanded gym tile
│   ├── data.ts               The only frontend module that talks to the API
│   └── App.css               All styling, including the mobile layout
├── src-tauri/                Tauri shell (desktop window only)
├── server/                   Python backend
│   ├── main.py               FastAPI app, routes, CORS, serves the built frontend
│   ├── db.py                 SQLite connection, schema, seed data, queries
│   ├── models.py             Pydantic models (camelCase JSON via alias generator)
│   ├── backup.py             Safe database snapshot, run nightly inside the container
│   ├── Dockerfile            Multi-stage: Node builds the frontend, Python serves it all
│   ├── docker-compose.yml    Build context is the repo root (`..`)
│   ├── pyproject.toml, uv.lock
├── .dockerignore             At repo root (because the build context is the root)
├── .env.example              VITE_API_URL=http://homelab1:8010
└── README.md                 OUTDATED, see "Known issues"
```

### Frontend details

**`data.ts`**
- `API_URL = import.meta.env.VITE_API_URL ?? ""`. Empty means same address the page came from (used by the phone version). The desktop sets it via a root `.env` to `http://homelab1:8010`, which is baked in at build time.
- Exports types `Exercise`, `WorkoutDay`, `GymPlan`, `ExerciseChanges`, and functions `getGymPlan`, `updateExercise`, `addExercise`, `reorderExercises`, `completeWorkout`. Each returns the full updated `GymPlan`.

**`App.tsx`**
- `tiles` array: `gym`, `todo`, `finance`, `habits`. The finance placeholder preview currently reads "Groceries: 50/250".
- `openTile` state switches between the grid and an expanded view. Escape closes a tile (`useEffect` with `[openTile]` in the dependency array).
- Gym data: `gymPlan` and `gymError` state. It refreshes on load, on window focus, on `visibilitychange` (for the phone), and every 60 seconds, with proper cleanup.
- `gymPreview()` shows the next day and its first active exercise.
- Gym-specific code is still wired directly into `App.tsx` (state, preview, `tile.id === "gym"` checks). **Extracting a reusable tile pattern is planned for when the second real tile is built.**

**`GymView.tsx`**
- Receives `plan` and `onChange`. Every action calls the API through `run()`, and the server's response becomes the new state. No draft, no Save button.
- `NumberField`: holds its own text while focused and only saves on blur or Enter, so typing doesn't send a request per keystroke and background refreshes can't overwrite what's being typed. Uses `inputMode="decimal"`.
- Two sections: "Today's workout" (active exercises) and the full pool for that day. Sets, reps and weight are editable in both. Exercises can be reordered within each section (▲▼) and moved between sections (+/−). New exercises can be added to the pool.
- "Complete workout" advances the push → pull → legs rotation.

**`App.css`**
- Theme tokens on `:root`: `--bg #1a1b26`, `--tile-bg #24283b`, `--text #c0caf5`, `--muted #7f87b0`.
- Exercise rows use a 7-column grid with **fixed widths** (`1fr 4rem 4rem 5.5rem 1.5rem 4.25rem 2rem`). Auto widths broke header alignment, because each row is its own grid.
- `@media (max-width: 640px)`: tiles stack in one column, exercise rows become cards via `grid-template-areas`, labels appear above inputs, inputs are 16px (stops iOS zooming), tap targets 2.75rem.

### Backend details

**Stack:** FastAPI, Pydantic, plain `sqlite3`, managed with uv.

**Models** (`models.py`) inherit from a `CamelModel` base with `alias_generator=to_camel` and `populate_by_name=True`, so Python uses `next_day_index` while JSON uses `nextDayIndex`.

**Database** (`db.py`)
- Path from env var `DASHBOARD_DB`, defaulting to `dashboard.db`. In Docker: `/data/dashboard.db`.
- `connect()` is a context manager: commits on success, rolls back on any exception, always closes.
- `init_db()` runs on startup through FastAPI's `lifespan`: creates tables if missing and seeds an empty database.
- Tables:
  - `workout_days (id, name, position)`
  - `exercises (id, day_id, name, weight REAL, sets, reps, position, active, PRIMARY KEY (day_id, id))`
  - `settings (key, value)`, which holds `next_day_index`
- `?` placeholders everywhere. The dynamic `SET` clause in `update_exercise` only takes column names from a fixed `EDITABLE_COLUMNS` set.

**Endpoints** (every mutation returns the full `GymPlan`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/gym/plan` | Full plan |
| PATCH | `/gym/days/{day_id}/exercises/{exercise_id}` | Change any of name, weight, sets, reps, active |
| POST | `/gym/days/{day_id}/exercises` | Add an exercise to the pool |
| PUT | `/gym/days/{day_id}/order` | New order; must list every exercise of the day exactly once |
| POST | `/gym/complete` | Advance to the next day |

- Validation in Pydantic (`weight >= 0`, `sets >= 1`, `reps >= 1`, name not empty) gives automatic 422 errors.
- Per-change endpoints were chosen deliberately, so two devices editing different exercises never overwrite each other.
- CORS allows `http://localhost:1420`, `tauri://localhost` and `http://tauri.localhost` (the desktop). The phone needs no CORS because the page and API share an address.
- The built frontend is mounted with `StaticFiles` at `/`, as the **last** thing in `main.py`, only if `server/static/` exists.

### Deployment

- **Dockerfile:** stage 1 `node:24-slim` runs `npm ci` and `npm run build`; stage 2 `python:3.12-slim` with uv `0.13.1` copies the server code and the built frontend into `./static`, then runs `fastapi run main.py --port 8000`.
- **Compose:** `restart: unless-stopped`, volume `./data:/data`, port bound to the Tailscale address via `BIND_ADDRESS` in the homelab's `server/.env`. Homelab port **8010** maps to container port 8000.
- **Updating the phone version or the API:** commit and push on the PC, then on the homelab: `cd ~/dashboard/server && git pull && docker compose up -d --build`.
- **Updating the desktop app:** `npm run tauri build -- --no-bundle` on the PC, then restart the app. The binary is at `src-tauri/target/release/dashboard`.
- Local development: `npm run tauri dev` for the frontend, and `uv run fastapi dev main.py` in `server/` for a local API on port 8000 (then point `.env` at localhost).

**Window rule** in `~/.config/hypr/input.lua`:
```lua
hl.window_rule({
  match = { class = "dashboard" },
  workspace = "5 silent",
})
```

### Backups

- `server/backup.py` uses SQLite's backup API (safe while the API is writing), runs `PRAGMA integrity_check`, and keeps the newest 14 snapshots in `server/data/backups/`.
- Homelab cron, 03:00 nightly: `docker compose exec -T api python backup.py`, logging to `~/dashboard-backup.log`.
- PC: systemd user timer (`~/.config/systemd/user/dashboard-backup.{service,timer}`) rsyncs snapshots to `~/Backups/dashboard/`, 5 minutes after boot and at 09:00, with `Persistent=true`. The PC keeps every snapshot.
- A restore has been tested successfully by pointing a local API at a snapshot.
- **To restore for real**, on the homelab: `docker compose down`, copy the snapshot over `data/dashboard.db`, `docker compose up -d`.
- Temporary arrangement: backups only live in the same house. A proper off-site solution is still to do.

## Known issues and loose ends

- **The README is outdated.** It still describes the local SQLite / `tauri-plugin-sql` version, the old draft-and-save flow, and lists "move the backend to a home server" as future work. It needs rewriting to cover the client-server architecture, the phone version, Docker deployment, backups and the design decisions above. High priority for the portfolio.
- Gym-specific code lives directly in `App.tsx`; a reusable tile pattern (summary view, expanded view, data source) still needs extracting.
- The Tauri template's leftover `greet` command is still in `src-tauri/src/lib.rs`.
- No authentication on the API. Acceptable while only my own devices are on the tailnet; reconsider before sharing access with anyone.
- The phone page needs a network connection. No offline support or proper PWA manifest yet.
- Things I'm not 100% sure were completed, so worth checking:
  - whether the compose port was made configurable (`${PORT:-8000}` with `PORT=8010` in the homelab `.env`) or edited directly on the homelab, which would block `git pull` there
  - whether the dashboard autostarts on login via `~/.config/hypr/autostart.lua`
  - whether a homelab reboot test passed. If the container fails to bind after reboot, the fix is `net.ipv4.ip_nonlocal_bind = 1` in `/etc/sysctl.d/`.

## Roadmap

1. **Finance tile** (next, see below)
2. README rewrite
3. To-do tile
4. Habit tracker tile
5. Gym progression history: a log of completed workouts and a progression graph (the current data only stores the *last* weight)
6. PWA / offline support for the phone, queuing changes when there's no signal at the gym
7. Follow the active Omarchy theme colours automatically
8. Parked idea: a tile showing growing open-source GitHub repos, with LLM-written plain-language summaries of each, so I can find projects to follow or contribute to

## Next step: the Finance tile

**Goal:** keep track of my monthly payments (rent, subscriptions, insurance and so on) and tick off whether each one has been paid this month.

Starting thoughts from the previous chat, to discuss rather than treat as decided:

- **Separate the bill from the payment.** A bill is the recurring thing (name, amount, due day of the month). Whether it's been paid is per month. So "paid" shouldn't be a true/false field on the bill; store payments per month instead, for example a `payments` table with `bill_id` and `period` (`"2026-11"`). Then every new month automatically starts unpaid, and there's a history for free. This is the same lesson as gym weights, where storing only the last value loses the history.
- **Store money as integer cents**, not floats. Floats can't represent amounts like 0.10 exactly.
- **Tile preview** could show something like "4 of 7 paid · €420 still due", or the next unpaid bill and its due date.
- **Expanded view:** this month's bills with a paid toggle; adding, editing and deactivating bills; maybe switching between months.
- **Backend:** new tables (plain `CREATE TABLE IF NOT EXISTS` is enough for new tables, no migration needed), Pydantic models and `/finance/...` endpoints following the same pattern as the gym endpoints. Financial data automatically gets the same backups, since it's the same database file.
- **Good moment for the tile abstraction:** finance is the second real tile, so this is when to pull the gym-specific code out of `App.tsx` into a shared pattern.
- **Open question:** is this only fixed monthly bills, or also budgets (the placeholder says "Groceries: 50/250", which sounds like a spending budget)? Those are different features, so decide that first.
