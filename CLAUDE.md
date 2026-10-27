# Dashboard project — handoff summary

Context for continuing this project in a new chat. Written at the end of the previous chat (October 2026).

**Repository:** https://github.com/FrandyMK/dashboard (public, branch `master`)

**Next step:** rewrite the README. See the "Next step" section.

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

A personal tile dashboard. Each tile shows a summary and opens into a small app when clicked. **The gym and finance tiles are fully working; to-do and habits tiles are placeholders.**

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
│   ├── App.tsx               Tile grid and the list of tiles; opens/closes tiles
│   ├── useLiveData.ts        Hook: loads a tile's data and keeps it fresh
│   ├── GymView.tsx           Expanded gym tile + gymPreview()
│   ├── FinanceView.tsx       Expanded finance tile + financePreview()
│   ├── money.ts              Cents ↔ text: formatEuros, parseEuros, toEuroInput
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
├── .claude/commands/handoff.md  `/handoff`: updates this file at the end of a session
├── .dockerignore             At repo root (because the build context is the root)
├── .env.example              VITE_API_URL=http://homelab1:8010
└── README.md                 OUTDATED, see "Known issues"
```

### Frontend details

**`data.ts`**
- `API_URL = import.meta.env.VITE_API_URL ?? ""`. Empty means same address the page came from (used by the phone version). The desktop sets it via a root `.env` to `http://homelab1:8010`, which is baked in at build time.
- `request<T>()` is generic: each caller names the type it expects (`request<GymPlan>`, `request<FinanceMonth>`). This is a promise to the compiler only; nothing checks the response at runtime.
- Gym: types `Exercise`, `WorkoutDay`, `GymPlan`, `ExerciseChanges`; functions `getGymPlan`, `updateExercise`, `addExercise`, `deleteExercise`, `reorderExercises`, `completeWorkout`. Each returns the full updated `GymPlan`.
- Finance: types `Payment`, `MonthBill`, `Bill`, `FinanceMonth`, `NewBill`, `BillChanges`; functions `getFinanceMonth`, `addBill`, `updateBill`, `markPaid`, `markUnpaid`. Each takes the `period` being viewed and returns that `FinanceMonth`.
- `currentPeriod()` gives the device's current month as `"2026-11"` in **local** time. `loadCurrentMonth()` is the finance tile's loader and calls `currentPeriod()` on every refresh, so the tile rolls over to a new month by itself.

**`useLiveData.ts`** (the data source part of a tile)
- `useLiveData(load)` returns `{ data, error, setData }`. It refreshes on load, on window focus, on `visibilitychange` (for the phone) and every 60 seconds, with cleanup.
- `load` must be a stable function defined outside any component (e.g. `getGymPlan`, `loadCurrentMonth`). An inline arrow would re-run the effect on every render and cause an endless request loop.
- Stale-refresh guard: a `latest` counter (`useRef`) goes up when a refresh starts and when `setData` is called with a mutation's response. A refresh only applies its answer if nothing newer happened since it started, so a slow background refresh can't undo a change you just made. `setData` also clears the error flag, since the server just answered.

**`App.tsx`**
- `Tile` type: `{ id, title, preview: string, view?: () => ReactNode }`. A tile without `view` is a placeholder. Each entry turns its own data into a preview string and a render function, so `App` deals with one plain shape whatever the data type.
- `previewOf(source, describe)` and `viewOf(source, render)` handle the loading/error states for every tile.
- Data hooks live in `App` (not inside each tile) so data survives opening and closing tiles.
- `tiles`: `gym` and `finance` are real; `todo` and `habits` are placeholders. Adding a tile = one `useLiveData` line + one array entry.
- `openTile` state switches between the grid and an expanded view. Escape closes a tile (`useEffect` with `[openTile]`).

**`GymView.tsx`**
- Exports `gymPreview(plan)` (next day and its first active exercise) alongside the component. Because the file exports a non-component, Vite does a full page reload instead of Fast Refresh when it changes during development. Harmless. Same for `FinanceView.tsx`.
- Receives `plan` and `onChange`. Every action calls the API through `run()`, and the server's response becomes the new state. No draft, no Save button.
- `NumberField`: holds its own text while focused and only saves on blur or Enter, so typing doesn't send a request per keystroke and background refreshes can't overwrite what's being typed. Uses `inputMode="decimal"`.
- Two sections: "Today's workout" (active exercises) and the full pool for that day. Sets, reps and weight are editable in both. Exercises can be reordered within each section (▲▼) and moved between sections (+/−). New exercises can be added to the pool.
- Exercises in the pool (not in today's workout) can be deleted with ✕. It takes two clicks: the first arms the button (red ✓), the second deletes. Moving the mouse away or tapping elsewhere disarms it (`confirmDelete` state, reset on `onMouseLeave` and `onBlur`).
- "Complete workout" advances the push → pull → legs rotation.

**`FinanceView.tsx`**
- `financePreview(month)`: "4 of 7 paid · € 420,00 still due", "All 7 paid this month", or "No bills yet".
- Shows the month name, the summary, and the month's bills (sorted by due day on the server). Each row: a checkbox inside a `<label>` (tapping the name ticks it), "Due 15 Oct" or "Paid 27 Oct", the amount, and ✎. A paid row shows the payment's stored amount, not the bill's current one.
- Every action uses `month.period` (the month on screen), never `currentPeriod()`.
- Overdue (unpaid and past its due date) shows the due date in red. A bill due on the 31st falls on the last day of shorter months (`new Date(year, month, 0)` trick).
- `BillForm` is shared by "New bill" and editing. It holds its own field state, validates with `parseEuros` and 1–31, and resets to its starting values after a successful save. `run()` returns whether the request worked, so a failed save keeps what you typed. Escape in the edit form cancels with `stopPropagation()`, so it doesn't close the whole tile.
- ✎ opens one bill at a time in edit mode (`editing` state). Saving sends **only the changed fields**, so two devices editing different fields of one bill don't overwrite each other. Deactivate sits in the edit form, with no confirm, because it's fully reversible.
- "Inactive bills" is a `<details>` section listing `month.inactive`, each with ↺ to reactivate.
- A bill that was paid this month and then deactivated shows in the month list marked "· inactive" (no ✎) and also in the inactive section. Unticking it makes it leave the month list.

**`money.ts`**
- `formatEuros(cents)` uses `Intl.NumberFormat("nl-NL", EUR)`, giving `€ 1.234,56` on every device.
- `parseEuros(text)` accepts `12,50`, `12.50`, `12`, `€ 1.234,56`; returns `null` for anything ambiguous (`1.234`, `12,555`) or invalid. It splits whole and fraction as strings instead of `parseFloat(text) * 100`, which silently reads `"12,50"` as 12 and has float errors.
- `toEuroInput(cents)` gives `"950,00"` for pre-filling the edit form.

**`App.css`**
- Theme tokens on `:root`: `--bg #1a1b26`, `--tile-bg #24283b`, `--text #c0caf5`, `--muted #7f87b0`.
- Exercise rows use an 8-column grid with **fixed widths** (`1fr 4rem 4rem 5.5rem 1.5rem 4.25rem 2rem 2rem`): name, sets, reps, weight, unit, ▲▼, +/−, delete. Auto widths broke header alignment, because each row is its own grid.
- Finance section: bill rows are a 4-column grid (`1fr auto 7rem 2rem`: name, due, amount, ✎). `.bill-form` is a grid shared by the add and edit forms; a local CSS variable `--field-bg` switches field colours between the two (page background vs. on a tile). `.bill.editing { display: block }` turns off the row grid while editing.
- `@media (max-width: 640px)`: tiles stack in one column, exercise rows become cards via `grid-template-areas` (bottom row: `order delete toggle`), bill rows become cards (`"main amount action" / "due due due"`), labels appear above inputs, inputs are 16px (stops iOS zooming), tap targets 2.75rem.

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
  - `bills (id, name, amount_cents, due_day, position, active)`: the recurring thing. `due_day` is 1–31. `position` only breaks ties between bills on the same due day.
  - `payments (bill_id REFERENCES bills, period, amount_cents, paid_at, PRIMARY KEY (bill_id, period))`: one row per bill per month it was paid. `period` is `"YYYY-MM"`, `paid_at` is a UTC ISO timestamp, and `amount_cents` is a **snapshot** of what was paid, so raising a bill's amount doesn't rewrite history.
- Money is integer cents everywhere, including the API.
- `load_month(conn, period)`: a `LEFT JOIN` from bills to that period's payments (the period condition sits in `ON`, not `WHERE`, or unpaid bills would vanish). Returns active bills plus any deactivated bill paid that month, ordered by `due_day, position`, plus `inactive`: every deactivated bill, ordered by name (`COLLATE NOCASE`).
- `mark_paid` uses `INSERT ... ON CONFLICT (bill_id, period) DO NOTHING`, so marking twice keeps the first payment and timestamp. `mark_unpaid` deletes the row; unpaying an unpaid bill isn't an error. Both return `False` (→ 404) only when the bill doesn't exist.
- `update_bill` follows the `update_exercise` pattern with its own `BILL_EDITABLE_COLUMNS` whitelist. Bills are never deleted, only deactivated (foreign keys would block deleting a bill with payments anyway).
- `?` placeholders everywhere. The dynamic `SET` clause in `update_exercise` only takes column names from a fixed `EDITABLE_COLUMNS` set.

**Endpoints** (every gym mutation returns the full `GymPlan`; every finance endpoint returns the `FinanceMonth` for the period the client is viewing)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/gym/plan` | Full plan |
| PATCH | `/gym/days/{day_id}/exercises/{exercise_id}` | Change any of name, weight, sets, reps, active |
| POST | `/gym/days/{day_id}/exercises` | Add an exercise to the pool |
| DELETE | `/gym/days/{day_id}/exercises/{exercise_id}` | Delete an exercise (404 if it doesn't exist) |
| PUT | `/gym/days/{day_id}/order` | New order; must list every exercise of the day exactly once |
| POST | `/gym/complete` | Advance to the next day |
| GET | `/finance/months/{period}` | Bills for that month with their payment (or `null`), plus `inactive` |
| POST | `/finance/bills?period=` | Add a bill (name, amountCents ≥ 0, dueDay 1–31) |
| PATCH | `/finance/bills/{bill_id}?period=` | Change any of name, amountCents, dueDay, active |
| PUT | `/finance/months/{period}/payments/{bill_id}` | Mark paid (idempotent; copies the bill's current amount) |
| DELETE | `/finance/months/{period}/payments/{bill_id}` | Mark unpaid (idempotent) |

- Validation in Pydantic (`weight >= 0`, `sets >= 1`, `reps >= 1`, name not empty; for bills `amount_cents >= 0`, `due_day` 1–31) gives automatic 422 errors.
- `period` is validated with `PERIOD_PATTERN` (`^\d{4}-(0[1-9]|1[0-2])$`) through reusable `Annotated` types, `PeriodInPath` and `PeriodInQuery`. FastAPI's `Path` is imported as `PathParam` because `main.py` already imports `pathlib.Path`.
- **The client chooses the month**, not the server. The container runs in UTC, so the server's "today" would reach the next month an hour late (two in summer). Each device sends its own local month instead.
- Per-change endpoints were chosen deliberately, so two devices editing different exercises never overwrite each other.
- CORS allows `http://localhost:1420`, `tauri://localhost` and `http://tauri.localhost` (the desktop). The phone needs no CORS because the page and API share an address.
- The built frontend is mounted with `StaticFiles` at `/`, as the **last** thing in `main.py`, only if `server/static/` exists.

### Deployment

- **Dockerfile:** stage 1 `node:24-slim` runs `npm ci` and `npm run build`; stage 2 `python:3.12-slim` with uv `0.13.1` copies the server code and the built frontend into `./static`, then runs `fastapi run main.py --port 8000`.
- **Compose:** `restart: unless-stopped`, volume `./data:/data`, ports `"${BIND_ADDRESS:-127.0.0.1}:${API_PORT:-8000}:8000"`. The homelab's `server/.env` (gitignored, machine-specific) sets `BIND_ADDRESS` to its Tailscale IP and `API_PORT=8010`; without a `.env` (e.g. on the PC) it falls back to `127.0.0.1:8000`. Nothing on the homelab is edited outside the repo, so `git pull` there stays clean.
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

- **The README is outdated.** It still describes the local SQLite / `tauri-plugin-sql` version, the old draft-and-save flow, and lists "move the backend to a home server" as future work. It needs rewriting to cover the client-server architecture, the phone version, Docker deployment, backups, the finance tile and the design decisions above. High priority for the portfolio.
- The stale-refresh guard covers refresh vs. mutation, but not two of *your own* mutations whose responses arrive out of order (e.g. two very fast taps). Rare on the tailnet; the next refresh corrects it. A one-at-a-time change queue in `request()` was tried and reverted; a server-side version number in every response is the more general option if it's ever needed.
- `fetch` has no timeout, so with bad signal (the gym) a change can hang until the browser gives up. Fix when it matters: `signal: AbortSignal.timeout(10_000)` in `request()`. Relevant again for the offline/PWA work.
- Pressing Enter twice quickly in the "New bill" form creates two identical bills (each Enter is a separate POST). Harmless (deactivate the copy); a `saving` flag would prevent it.
- Finance has no month switching in the UI yet, though the API already serves any period. When it's added: a bill created later will show as unpaid in earlier months (the month view doesn't know when a bill started), and that's worth handling or documenting.
- Marking a bill paid always records its current amount. Bills that vary month to month (energy) would need an optional amount on the PUT.
- The Tauri template's leftover `greet` command is still in `src-tauri/src/lib.rs`.
- No authentication on the API. Acceptable while only my own devices are on the tailnet; reconsider before sharing access with anyone.
- The phone page needs a network connection. No offline support or proper PWA manifest yet.
- Things I'm not 100% sure were completed, so worth checking:
  - whether the dashboard autostarts on login via `~/.config/hypr/autostart.lua`
  - whether a homelab reboot test passed. If the container fails to bind after reboot, the fix is `net.ipv4.ip_nonlocal_bind = 1` in `/etc/sysctl.d/`.

## Roadmap

1. README rewrite (next, see below)
2. To-do tile
3. Habit tracker tile
4. Finance extras: switching between months, a custom amount when marking paid
5. Gym progression history: a log of completed workouts and a progression graph (the current data only stores the *last* weight)
6. PWA / offline support for the phone, queuing changes when there's no signal at the gym
7. Follow the active Omarchy theme colours automatically
8. Parked idea: a tile showing growing open-source GitHub repos, with LLM-written plain-language summaries of each, so I can find projects to follow or contribute to

## Next step: README rewrite

The README is the first thing anyone sees on GitHub, and it still describes the old local-only version. Rewrite it to cover:

- What the dashboard is, with screenshots of the grid, the gym tile and the finance tile (desktop and phone).
- The architecture: one React codebase in two places (Tauri on the desktop, the browser on the phone), one FastAPI + SQLite server on the homelab over Tailscale, the server as the single source of truth.
- How to run it locally and how it's deployed (Docker, compose, the `.env` values), plus backups and the tested restore.
- The design decisions worth explaining, each in a sentence or two: per-change endpoints instead of saving a whole document; server responses replace client state; integer cents; bills separate from payments (history for free, payment amount as a snapshot); the client choosing the month (timezones); idempotent PUT/DELETE for paid/unpaid; the tile pattern and `useLiveData`, including the stale-refresh guard; deactivate instead of delete.
- Honest limitations: no auth (tailnet only), no offline support, and the items under "Known issues".

## Session log

(newest first)

**2026-10-27 (finance)**
- Built the finance tile, bills only. Budgets are a different feature (a spending log against a limit) and were left for later. Bills and payments are separate tables; payments store their own amount, so history survives price changes.
- Backend: `bills`/`payments` tables and `/finance/...` endpoints. The client sends the month (`"2026-11"`) because the container runs in UTC. Paid/unpaid are idempotent PUT/DELETE. Every response is the viewed month, including inactive bills.
- Frontend: extracted the tile pattern (`useLiveData`, `Tile`, `previewOf`/`viewOf`) out of `App.tsx` once there were two real tiles, made `request<T>` generic, and added `FinanceView` with add/edit/deactivate/reactivate and `money.ts`. Added a stale-refresh guard to `useLiveData` after confirming a slow background refresh could undo a just-ticked bill.
- Tried sending changes one at a time (a promise-chain queue in `request()`) so two fast taps can't have their answers arrive out of order, then reverted it. It's back to a plain `request()`; out-of-order answers stay a known issue.
- Confirmed the compose port is configurable via `API_PORT` in the homelab's gitignored `server/.env`, so `git pull` there stays clean.
- Fixed a CSS typo (`overflow-y: auto:`) that stopped the expanded view from scrolling itself.

**2026-10-27**
- Brought this file up to date with the delete button (`7c30c86`, 2026-10-23), which was committed before these notes were written but missing from them.
- Restored deleting exercises from the pool. It existed in the old local-SQLite version (`639f305`) but was lost in the move to the API (`3ff03e2`). Re-added as a `DELETE` endpoint, `deleteExercise()` in `data.ts`, and a two-click ✕ button. Only pool exercises can be deleted, so nothing in today's workout disappears by accident.
- Renamed `claude.md` to `CLAUDE.md` so Claude Code loads it automatically, and added the `/handoff` command.
