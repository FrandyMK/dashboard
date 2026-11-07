# Dashboard project — handoff summary

Context for continuing this project in a new chat. Written at the end of the previous chat (November 2026).

**Repository:** https://github.com/FrandyMK/dashboard (public, branch `master`)

**Next step:** check the swipeable day cards on the phone, bring the README up to date (month switching and the gym days screen), add screenshots, then the to-do tile. See the "Next step" section.

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
│   ├── main.py               FastAPI app, routes, CORS, serves the built frontend (with cache headers)
│   ├── db.py                 SQLite connection, schema, seed data, queries
│   ├── models.py             Pydantic models (camelCase JSON via alias generator)
│   ├── backup.py             Safe database snapshot, run nightly inside the container
│   ├── Dockerfile            Multi-stage: Node builds the frontend, Python serves it all
│   ├── docker-compose.yml    Build context is the repo root (`..`)
│   ├── pyproject.toml, uv.lock
├── .claude/commands/handoff.md  `/handoff`: updates this file at the end of a session
├── .dockerignore             At repo root (because the build context is the root)
├── .env.example              VITE_API_URL=http://homelab1:8010
├── LICENSE                   MIT
└── README.md                 Features, architecture, design decisions, setup, deployment, limitations
```

### Frontend details

**`data.ts`**
- `API_URL = import.meta.env.VITE_API_URL ?? ""`. Empty means same address the page came from (used by the phone version). The desktop sets it via a root `.env` to `http://homelab1:8010`, which is baked in at build time.
- `request<T>()` is generic: each caller names the type it expects (`request<GymPlan>`, `request<FinanceMonth>`). This is a promise to the compiler only; nothing checks the response at runtime.
- `request()` queues non-GET requests through `previousChange` so they're sent one at a time; `send()` does the actual fetch.
- Gym: types `Exercise`, `WorkoutDay`, `GymPlan`, `ExerciseChanges`; functions `getGymPlan`, `updateExercise`, `addExercise`, `deleteExercise`, `reorderExercises`, `addDay`, `deleteDay`, `reorderDays`, `completeWorkout(dayId)`. Each returns the full updated `GymPlan`.
- Finance: types `Payment`, `MonthBill`, `Bill`, `FinanceMonth`, `NewBill`, `BillChanges`; functions `getFinanceMonth`, `addBill`, `updateBill`, `markPaid`, `markUnpaid`. Each takes the `period` being viewed and returns that `FinanceMonth`.
- `currentPeriod()` gives the device's current month as `"2026-11"` in **local** time. `shiftPeriod(period, months)` moves a period forward or back (`shiftPeriod("2026-01", -1)` is `"2025-12"`); it builds `new Date(year, month - 1 + months, 1)`, which handles the year overflow, and formats it with `currentPeriod`. (`loadCurrentMonth()` is gone; the loader now lives in `App`.)

**`useLiveData.ts`** (the data source part of a tile)
- `useLiveData(load)` returns `{ data, error, setData }`. It refreshes on load, on window focus, on `visibilitychange` (for the phone) and every 60 seconds, with cleanup.
- `load` must be the same function on every render: defined outside any component (e.g. `getGymPlan`) or wrapped in `useCallback` (the finance loader). An inline arrow would re-run the effect on every render and cause an endless request loop. When a `useCallback` dependency changes, the effect deliberately starts over with the new loader; the stale-refresh guard drops any answer still in flight for the old one.
- Stale-refresh guard: a `latest` counter (`useRef`) goes up when a refresh starts and when `setData` is called with a mutation's response. A refresh only applies its answer if nothing newer happened since it started, so a slow background refresh can't undo a change you just made. `setData` also clears the error flag, since the server just answered.
- Out-of-order changes can't happen either: `request()` in `data.ts` sends changes (anything not GET) one at a time, each waiting for the previous answer. A failed change doesn't block the queue. The more general alternative, a server-side version number in every response, was considered and left for if it's ever needed.

**`App.tsx`**
- `Tile` type: `{ id, title, preview: string, view?: () => ReactNode }`. A tile without `view` is a placeholder. Each entry turns its own data into a preview string and a render function, so `App` deals with one plain shape whatever the data type.
- `previewOf(source, describe)` and `viewOf(source, render)` handle the loading/error states for every tile.
- Data hooks live in `App` (not inside each tile) so data survives opening and closing tiles.
- `tiles`: `gym` and `finance` are real; `todo` and `habits` are placeholders. Adding a tile = one `useLiveData` line + one array entry.
- Finance month: `financePeriod` state (`string | null`; `null` = the current month, re-read with `currentPeriod()` on every refresh, so the tile still rolls over on the 1st). The loader is `useCallback(() => getFinanceMonth(financePeriod ?? currentPeriod()), [financePeriod])`. `FinanceView` gets `setFinancePeriod` as `onPeriodChange`. It lives in `App`, next to the data hook, because the hook needs it.
- `openTile` state switches between the grid and an expanded view. Escape and ← Back both call `closeTile()`, which also resets `financePeriod` to `null`, so the grid preview is always about the current month.

**`GymView.tsx`**
- Exports `gymPreview(plan)` (next day and its first active exercise) alongside the component. Because the file exports a non-component, Vite does a full page reload instead of Fast Refresh when it changes during development. Harmless. Same for `FinanceView.tsx`.
- Two components. The default export `GymView` is the **days screen**, the first thing you see when the tile opens; `DayView` is one opened day. `GymView` holds `openDayId` (`string | null`; `null` = the days screen) and renders `DayView` (with `key={day.id}`, so its state resets per day) when it's set. If the open day disappears (deleted on another device), it falls back to the list. Since `GymView` unmounts when the tile closes, every open starts on the days screen.
- Days screen: one card (`.day-open` button) per day in rotation order, showing the name, a "Next" badge on `plan.days[plan.nextDayIndex]`, and "4 in workout · 9 in pool". Per row: ▲▼ (`reorderDays`, swap with the neighbour and send the full id list), and a two-click ✕ to delete (hidden when only one day is left). "+ Add day" input underneath.
- Opening a day changes nothing on the server, so looking at leg day doesn't touch the rotation. "‹ All days" at the top of `DayView` goes back.
- Every action calls the API through `run()`, and the server's response becomes the new state. No draft, no Save button. In `DayView`, `run()` returns whether it worked, so Complete only goes back to the list on success.
- `NumberField`: holds its own text while focused and only saves on blur or Enter, so typing doesn't send a request per keystroke and background refreshes can't overwrite what's being typed. Uses `inputMode="decimal"`.
- `NoteField`: a one-line note under each exercise (e.g. "straight back next time"), built the same way as `NumberField`. Enter or clicking away saves (trimmed, only if changed); Escape cancels and uses `stopPropagation()` so it doesn't close the tile. Escape also blurs the input, which would normally save, so a `cancelled` ref tells that blur to skip. It's a ref, not state, because nothing has to re-render. Empty notes show as a faint "Add a note…". One current note per exercise, overwritten like the weight, not a history.
- `DayView` has two sections: "Today's workout" (active exercises, always open) and the pool, a closed-by-default `<details className="pool">` titled "All push day exercises (5)", which also holds the "add exercise" input. `<details>` keeps its own open state; React doesn't touch it on re-render, so background refreshes don't close it. Sets, reps and weight are editable in both. Exercises can be reordered within each section (▲▼) and moved between sections (+/−).
- Exercises in the pool (not in today's workout) can be deleted with ✕. It takes two clicks: the first arms the button (red ✓), the second deletes. Moving the mouse away or tapping elsewhere disarms it (`confirmDelete` state, reset on `onMouseLeave` and `onBlur`).
- "Complete workout ✓" sends the opened day's id. The server logs a snapshot of that day (see `workouts` under Database) and makes the day after it (in the days-screen order) the next one, then the view returns to the days screen. So days can be done in any order and "Next" still follows the order on screen.
- Collapsible cards on the phone: `openExercise` state (`string | null`, one open at a time, like `editing` in `FinanceView`). The name is a `<button className="ex-name">` with `aria-expanded` that toggles it, and it contains a faded `.ex-summary` ("3 × 8 · 80 kg") shown only on the phone while closed. Sets, reps, weight, unit, delete and note sit inside `.ex-details > .ex-details-inner`; ▲▼ and +/− stay outside, so they work on a closed card. The delete button sits in a `.ex-delete` span (empty for active exercises) so the slot always exists. On the desktop the click changes state but CSS ignores it.

**`FinanceView.tsx`**
- `financePreview(month)`: "4 of 7 paid · € 420,00 still due", "All 7 paid this month", or "No bills yet".
- Month navigation: `‹ Month Year ›` (`.month-nav`), plus a "This month" button when another month is shown. The arrows step from `month.period` (the month on screen), not from the requested month, so tapping twice before the next month loads never skips a month you haven't seen. Past and future months both work; ticking in a future month pays ahead.
- Shows the month name, the summary, and the month's bills (ordered on the server: unpaid by due day first, then paid ones in the order they were ticked, so ticking a bill moves it to the bottom). Each row: a checkbox inside a `<label>` (tapping the name ticks it), "Due 15 Oct" or "Paid 27 Oct", the amount, and ✎. A paid row shows the payment's stored amount, not the bill's current one.
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
- Days screen: `.day-list` is a flex column; `.day-row` is a grid `1fr auto 2rem` (card, ▲▼, ✕). ▲▼ and ✕ sit in a `.day-actions` span that is `display: contents` on the desktop.
- On the phone (a separate `@media (max-width: 640px)` block at the end of the file) each `.day-row` is a sideways-scrolling flex row with `scroll-snap-type: x mandatory`: the card is `flex: 0 0 100%` and snaps to `start`, `.day-actions` snaps to `end`. Swiping left reveals ▲▼ ✕, swiping back hides them. Pure CSS, no touch handlers, so the browser's own momentum and snapping are used; the scrollbar is hidden. Each row stays where you left it (opening one doesn't close the others). `.day-row.next .day-open` gets a brighter border; `.day-next` is the small "Next" badge.
- Theme tokens on `:root`: `--bg #1a1b26`, `--tile-bg #24283b`, `--text #c0caf5`, `--muted #7f87b0`.
- Exercise rows use an 8-column grid with **fixed widths** (`1fr 4rem 4rem 5.5rem 1.5rem 4.25rem 2rem 2rem`): name, sets, reps, weight, unit, ▲▼, +/−, delete. Auto widths broke header alignment, because each row is its own grid. The note input (`.ex-note`) uses `grid-column: 1 / -1`, so it wraps onto its own full-width line under the row.
- On the desktop `.ex-details` and `.ex-details-inner` are `display: contents`, so their children are cells of the row grid as before. In the HTML, delete and note now come before ▲▼ and +/−, so `.ex-delete` and `.ex-note` get `order: 1` to put them back at the end of the row.
- Finance section: bill rows are a 4-column grid (`1fr auto 7rem 2rem`: name, due, amount, ✎). `.bill-form` is a grid shared by the add and edit forms; a local CSS variable `--field-bg` switches field colours between the two (page background vs. on a tile). `.bill.editing { display: block }` turns off the row grid while editing. `.month-nav` is a wrapping flex row; its buttons get `--tile-bg` because they sit on the page background, and the `h2` has a `min-width` so › doesn't move between month names.
- `@media (max-width: 640px)`: tiles stack in one column, exercise rows become collapsible cards (`"name order toggle" / "details details details"`; inside the details `"sets reps weight delete" / "note note note note"`). The slide is `grid-template-rows: 0fr → 1fr` on `.ex-details` with a 200ms transition, because `height: auto` can't be animated; the inner box has `min-height: 0; overflow: hidden`, and `visibility: hidden` when closed so its inputs can't take focus or taps (visibility only switches off at the end of the closing transition). bill rows become cards (`"main amount action" / "due due due"`), labels appear above inputs, inputs are 16px (stops iOS zooming), tap targets 2.75rem.

### Backend details

**Stack:** FastAPI, Pydantic, plain `sqlite3`, managed with uv.

**Models** (`models.py`) inherit from a `CamelModel` base with `alias_generator=to_camel` and `populate_by_name=True`, so Python uses `next_day_index` while JSON uses `nextDayIndex`.

**Database** (`db.py`)
- Path from env var `DASHBOARD_DB`, defaulting to `dashboard.db`. In Docker: `/data/dashboard.db`.
- `connect()` is a context manager: commits on success, rolls back on any exception, always closes.
- `init_db()` runs on startup through FastAPI's `lifespan`: creates tables if missing, runs `migrate()`, and seeds an empty database.
- `migrate(conn)`: `CREATE TABLE IF NOT EXISTS` skips existing tables, so new columns never reach an existing database through `SCHEMA`. `migrate` checks `PRAGMA table_info(...)` and adds what's missing: `exercises.note`, and `bills.start_period` (added with `DEFAULT ''`, then backfilled once with each bill's earliest payment period, or the current UTC month for bills never paid). Safe on every startup. Future columns on existing tables need the same treatment.
- The note is `''` when empty, never `NULL`: clearing a note sends `""`, which survives the PATCH route's `exclude_none=True` (a `None` would mean "not changing this field").
- Tables:
  - `workout_days (id, name, position)`
  - `exercises (id, day_id, name, weight REAL, sets, reps, position, active, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (day_id, id))`
  - `settings (key, value)`, which holds `next_day_index`
  - `bills (id, name, amount_cents, due_day, position, active, start_period)`: the recurring thing. `due_day` is 1–31. `position` only breaks ties between bills on the same due day. `start_period` (`"YYYY-MM"`) is the first month the bill appears in; `add_bill` sets it to the period the client was viewing, so adding a bill while looking at December schedules it from December.
  - `payments (bill_id REFERENCES bills, period, amount_cents, paid_at, PRIMARY KEY (bill_id, period))`: one row per bill per month it was paid. `period` is `"YYYY-MM"`, `paid_at` is a UTC ISO timestamp, and `amount_cents` is a **snapshot** of what was paid, so raising a bill's amount doesn't rewrite history.
  - `workouts (id INTEGER PRIMARY KEY, day_id, day_name, completed_at)`: one row per completed session. `completed_at` is a UTC ISO timestamp.
  - `workout_exercises (workout_id REFERENCES workouts, exercise_id, exercise_name, position, sets, reps, weight REAL, note, PRIMARY KEY (workout_id, exercise_id))`, plus index `workout_exercises_by_exercise (exercise_id)` for future per-exercise history queries. **No foreign key to `exercises`** and the name is copied, so renaming or deleting an exercise never blocks or rewrites history.
- `next_day_index` is a **position** in the `ORDER BY position` list, not a day id. Every function that changes the list of days fixes it up: `delete_day` lowers it by one if the deleted day came before it (deleting the current day lets the following day slide into its place), then takes it `% count`; `reorder_days` remembers which day it pointed to and looks that day up again in the new order. `load_plan` also clamps it `% len(days)` as a safety net, because the frontend reads `plan.days[plan.nextDayIndex]` directly. Storing a day id instead would avoid the fix-ups; not done because these three places cover it.
- `add_day` appends at `MAX(position) + 1` with a `uuid4().hex` id and an empty pool. `delete_day` deletes the day's exercises and the day in one transaction, refuses the last remaining day, and returns `None`, `"not found"` or `"last day"` (→ 404 / 400). History survives because `workout_exercises` copies names and has no foreign key.
- `complete_workout(conn, day_id=None)` logs the given day, or without one the day at `next_day_index` (what old clients send), calls `log_workout` (one `INSERT` into `workouts`, then `INSERT ... SELECT` of that day's `active = 1` exercises), then sets `next_day_index` to the position after the logged day. Returns `False` (→ 404) for an unknown day. All in one transaction. It logs on Complete rather than on every edit, because edits are noisy (typos, corrections) and Complete means it was actually done. Rough size: ~100 KB a year, so nothing is ever pruned. Nothing reads the log yet; for analysis, open a backup `.db` with Python/pandas.
- Money is integer cents everywhere, including the API.
- `load_month(conn, period)`: a `LEFT JOIN` from bills to that period's payments (the period condition sits in `ON`, not `WHERE`, or unpaid bills would vanish). Returns active bills whose `start_period <= period` plus any bill paid that month (a payment always shows, even before the start or after deactivation), ordered by `p.bill_id IS NOT NULL, p.paid_at, b.due_day, b.position` (unpaid first by due day, then paid by when they were paid; each key only breaks ties in the one before it), plus `inactive`: every deactivated bill, ordered by name (`COLLATE NOCASE`).
- `mark_paid` uses `INSERT ... ON CONFLICT (bill_id, period) DO NOTHING`, so marking twice keeps the first payment and timestamp. `mark_unpaid` deletes the row; unpaying an unpaid bill isn't an error. Both return `False` (→ 404) only when the bill doesn't exist.
- `update_bill` follows the `update_exercise` pattern with its own `BILL_EDITABLE_COLUMNS` whitelist. Bills are never deleted, only deactivated (foreign keys would block deleting a bill with payments anyway).
- `?` placeholders everywhere. The dynamic `SET` clause in `update_exercise` only takes column names from a fixed `EDITABLE_COLUMNS` set.

**Endpoints** (every gym mutation returns the full `GymPlan`; every finance endpoint returns the `FinanceMonth` for the period the client is viewing)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/gym/plan` | Full plan |
| PATCH | `/gym/days/{day_id}/exercises/{exercise_id}` | Change any of name, weight, sets, reps, active, note |
| POST | `/gym/days/{day_id}/exercises` | Add an exercise to the pool |
| DELETE | `/gym/days/{day_id}/exercises/{exercise_id}` | Delete an exercise (404 if it doesn't exist) |
| PUT | `/gym/days/{day_id}/order` | New order; must list every exercise of the day exactly once |
| POST | `/gym/days` | Add a day (`{ name }`, trimmed, not empty) at the end of the rotation |
| DELETE | `/gym/days/{day_id}` | Delete a day and its exercises (404 unknown, 400 if it's the last day) |
| PUT | `/gym/days/order` | New day order (`{ dayIds }`); must list every day exactly once; keeps the same day as next |
| POST | `/gym/complete` | Body `{ dayId }`: log that day's active exercises, then make the day after it next. Without a body: the current next day (older desktop builds) |
| GET | `/finance/months/{period}` | Bills for that month with their payment (or `null`), plus `inactive` |
| POST | `/finance/bills?period=` | Add a bill (name, amountCents ≥ 0, dueDay 1–31), starting in `period` |
| PATCH | `/finance/bills/{bill_id}?period=` | Change any of name, amountCents, dueDay, active |
| PUT | `/finance/months/{period}/payments/{bill_id}` | Mark paid (idempotent; copies the bill's current amount) |
| DELETE | `/finance/months/{period}/payments/{bill_id}` | Mark unpaid (idempotent) |

- Validation in Pydantic (`weight >= 0`, `sets >= 1`, `reps >= 1`, name not empty, note at most 500 characters and allowed to be empty; for bills `amount_cents >= 0`, `due_day` 1–31) gives automatic 422 errors.
- `period` is validated with `PERIOD_PATTERN` (`^\d{4}-(0[1-9]|1[0-2])$`) through reusable `Annotated` types, `PeriodInPath` and `PeriodInQuery`. FastAPI's `Path` is imported as `PathParam` because `main.py` already imports `pathlib.Path`.
- **The client chooses the month**, not the server. The container runs in UTC, so the server's "today" would reach the next month an hour late (two in summer). Each device sends its own local month instead.
- Per-change endpoints were chosen deliberately, so two devices editing different exercises never overwrite each other.
- CORS allows `http://localhost:1420`, `tauri://localhost` and `http://tauri.localhost` (the desktop). The phone needs no CORS because the page and API share an address.
- The built frontend is mounted at `/`, as the **last** thing in `main.py`, only if `server/static/` exists. It uses `FrontendFiles`, a `StaticFiles` subclass that adds `Cache-Control`: files under `assets/` get `public, max-age=31536000, immutable` (Vite puts a content hash in their names, so a new build means new names), and everything else, mainly `index.html`, gets `no-cache` (the browser keeps it but checks with the server each time, usually getting a `304`). Without this the phone's home-screen app kept showing an old `index.html` after a deploy.

### Deployment

- **Dockerfile:** stage 1 `node:24-slim` runs `npm ci` and `npm run build`; stage 2 `python:3.12-slim` with uv `0.13.1` copies the server code and the built frontend into `./static`, then runs `fastapi run main.py --port 8000`.
- **Compose:** `restart: unless-stopped`, volume `./data:/data`, ports `"${BIND_ADDRESS:-127.0.0.1}:${API_PORT:-8000}:8000"`. The homelab's `server/.env` (gitignored, machine-specific) sets `BIND_ADDRESS` to its Tailscale IP and `API_PORT=8010`; without a `.env` (e.g. on the PC) it falls back to `127.0.0.1:8000`. Nothing on the homelab is edited outside the repo, so `git pull` there stays clean.
- **Updating the phone version or the API:** commit and push on the PC, then on the homelab: `cd ~/dashboard/server && git pull && docker compose up -d --build`.
- **Updating the desktop app:** `npm run tauri build -- --no-bundle` on the PC, then restart the app. The binary is at `src-tauri/target/release/dashboard`.
- Local development: `uv run fastapi dev main.py` in `server/` for a local API on port 8000 (uses `server/dashboard.db` on the PC, not homelab data), and `VITE_API_URL=http://localhost:8000 npm run tauri dev` in the repo root. A variable set in the shell beats the one in `.env`, so the file never has to be edited or changed back.

**Window rule** in `~/.config/hypr/input.lua`:
```lua
hl.window_rule({
  match = { class = "dashboard" },
  workspace = "5 silent",
})
```

### Backups

- `server/backup.py` uses SQLite's backup API (safe while the API is writing), runs `PRAGMA integrity_check`, and keeps the newest 14 snapshots in `server/data/backups/`.
- Homelab cron (user `dingo11`), 03:00 nightly in the homelab's UTC clock: `0 3 * * * cd /home/dingo11/dashboard/server && docker compose exec -T api python backup.py >> /home/dingo11/dashboard-backup.log 2>&1`. Until 2026-11-07 it still had the `/home/youruser` placeholder, so it never ran and the only snapshot was a manual one from 2026-10-22.
- PC: systemd user timer (`~/.config/systemd/user/dashboard-backup.{service,timer}`) rsyncs snapshots to `~/Backups/dashboard/`, 5 minutes after boot and at 09:00, with `Persistent=true`. The PC keeps every snapshot.
- A restore has been tested successfully by pointing a local API at a snapshot.
- **To restore for real**, on the homelab: `docker compose down`, copy the snapshot over `data/dashboard.db`, `docker compose up -d`.
- Temporary arrangement: backups only live in the same house. A proper off-site solution is still to do.

## Known issues and loose ends

- `fetch` has no timeout, and changes are queued one at a time. With bad signal (the gym), one hanging change blocks every change after it until the browser gives up. Fix when it matters: `signal: AbortSignal.timeout(10_000)` in `send()`. Relevant again for the offline/PWA work.
- Pressing Enter twice quickly in the "New bill" form creates two identical bills (each Enter is a separate POST). Harmless (deactivate the copy); a `saving` flag would prevent it.
- A bill's start month can't be changed in the UI. A bill added while viewing the wrong month needs `UPDATE bills SET start_period = ...` by hand.
- Deactivating a bill removes it from every month it wasn't paid in, including past ones (there's no `end_period`).
- Days can't be renamed in the UI (only added, deleted and reordered). A typo means delete and re-add, or `UPDATE workout_days SET name = ...`.
- Escape inside an opened gym day closes the whole tile instead of going back to the days screen (`App`'s window listener handles Escape).
- The gym days work (`a447223`..`ee3910f`) is deployed on the homelab. Not confirmed: whether the desktop app was rebuilt afterwards.
- In a month other than the current one, the summary still says "All 9 paid this month".
- The README is behind on month switching: line ~190 (Limitations) still says "Finance shows only the current month", and the roadmap (line ~203) lists switching months as not done. Features (line ~26) could mention it.
- Not confirmed: whether the desktop app was rebuilt (`npm run tauri build -- --no-bundle`) after the month-switching deploy, and how the month bar looks on the phone.
- Marking a bill paid always records its current amount. Bills that vary month to month (energy) would need an optional amount on the PUT.
- Notes on the plan are one current note per exercise, but each completed workout now keeps a copy of the notes in `workout_exercises`.
- Pressing "Complete workout" without training logs a fake session. A very fast double tap could still send two before the view switches back to the days screen. There's no way to delete a log entry yet; fix with SQL if needed, or add an undo later.
- Confirm the fixed cron actually runs on its own: after 03:00 UTC on 2026-11-08 there should be a `dashboard-..._0300.db` in `~/dashboard/server/data/backups/` and a `~/dashboard-backup.log` on the homelab. The rsync timer on the PC had been "succeeding" while there was nothing new to copy, so check the files, not the service status.
- The Tauri template's leftover `greet` command is still in `src-tauri/src/lib.rs`.
- No authentication on the API. Acceptable while only my own devices are on the tailnet; reconsider before sharing access with anyone.
- The phone page needs a network connection. No offline support or proper PWA manifest yet.
- Things I'm not 100% sure were completed, so worth checking:
  - whether the dashboard autostarts on login via `~/.config/hypr/autostart.lua`
  - whether a homelab reboot test passed. If the container fails to bind after reboot, the fix is `net.ipv4.ip_nonlocal_bind = 1` in `/etc/sysctl.d/`.

## Roadmap

1. README: month switching, the gym days screen, plus screenshots (next, see below)
2. To-do tile
3. Habit tracker tile
4. Finance extras: a custom amount when marking paid; maybe editing a bill's start month
5. Gym progression: the log is done and collecting data. Still to do, when wanted: a history endpoint (e.g. `GET /gym/days/{day_id}/exercises/{exercise_id}/history`, oldest first), a small SVG weight-over-time chart in the opened card, and maybe a one-off backfill from old backup snapshots. Not wanted yet (2026-11-07): for now it's enough that the data is stored and backed up
6. PWA / offline support for the phone, queuing changes when there's no signal at the gym
7. Follow the active Omarchy theme colours automatically
8. Parked idea: a tile showing growing open-source GitHub repos, with LLM-written plain-language summaries of each, so I can find projects to follow or contribute to

## Next step: deploy, then finish the README

First check the swipeable day cards on the phone after deploying them (`cd ~/dashboard/server && git pull && docker compose up -d --build` on the homelab), and rebuild the desktop app (`npm run tauri build -- --no-bundle`) if that wasn't done yet.

The README was rewritten on 2026-11-07 (architecture, design decisions, local setup, deployment, backups, limitations, roadmap) and updated the same evening for the collapsible phone cards and the workout log. Three things are missing:

- **Gym days screen.** Features: the tile opens on a list of days (add, delete, reorder; "Next" badge), tapping a day opens it, the pool is collapsed, Complete logs the opened day and goes back. Design decisions: why opening a day doesn't change the rotation (only Complete does), and that `next_day_index` is a position fixed up on delete/reorder. Endpoints if the README lists them.

- **Month switching.** Update Features (line ~26), drop "Finance shows only the current month" from Limitations (line ~190, keep the sentence about the paid amount), tick "switch between months" in the roadmap (line ~203, keep "custom amount" open), and consider a short design-decision paragraph on `start_period` (why bills need a start month, and that adding while viewing a month schedules it from that month).
- **Screenshots.** An HTML comment near the top of `README.md` lists the planned images: `docs/grid.png`, `docs/gym.png`, `docs/finance.png`, `docs/phone.png`. Take them (desktop and phone), put them in `docs/`, and turn the comment into real image links.

After that: the to-do tile (roadmap item 2).

## Session log

(newest first)

**2026-11-07 (late night, phone)**
- The gym days work was deployed on the homelab. On the phone the ▲▼ ✕ took half of each day card's width, so day rows now scroll sideways with CSS scroll snap: the card fills the screen, swipe left to reveal the buttons. Chosen over JavaScript touch handling because it's a few lines of CSS and feels native. Committed and pushed as `0aea5c4`; checked in a phone-sized headless Chromium, not yet on the real phone.

**2026-11-07 (late night)**
- Gym pool is now a closed-by-default `<details>` (`a447223`); "Today's workout" stays open.
- Workout days can be added, deleted (with their exercises; never the last one) and reordered (`ab502ef`, `ee3910f`). `next_day_index` stayed a position and is fixed up in `delete_day`/`reorder_days`, tested for deleting before/at/after the current day.
- The gym tile now opens on a days screen; tapping a day opens it and Complete logs *that* day, makes the next one in screen order "Next" and goes back (`d468473`). A tap-to-switch endpoint (`cd2b9ad`) was tried first and removed, because opening a day to look at it shouldn't change the rotation. `POST /gym/complete` without a body still works for old desktop builds. All pushed; deploy not confirmed.

**2026-11-07 (night)**
- Finance month switching (`8c0913a`): `‹ ›` arrows and "This month". The month lives in `App` as `financePeriod` (`null` = current, so the 1st still rolls over), the loader is a `useCallback`, and closing the tile resets it. Confirmed beforehand that October's 9 payments were intact in the PC backup: rows in `payments` are never cleared when a month ends.
- Bills got a `start_period` (`edb97ce`), because otherwise every bill added in November showed as unpaid and overdue in October. Adding a bill while viewing a month starts it there, which is also how you schedule ahead. Migration backfills from the first paid month. Tested on a copy of the 2026-11-07 snapshot (Oct: 9 paid; Pwn and Kpn - Persoonlijk start in Nov), pushed and deployed on the homelab; October shows correctly there.

**2026-11-07 (evening)**
- Phone gym cards are now collapsible: a closed card shows the name, a faded "3 × 8 · 80 kg" summary, ▲▼ and +/−; tapping the name slides open sets/reps/weight/note/delete (one at a time). Done with wrappers that are `display: contents` on the desktop, so the desktop row is unchanged. Committed as `220fa4f`.
- Updated the README for both gym changes (features, two design-decision paragraphs, limitations, roadmap).
- Workout history: "Complete workout" now snapshots that day's active exercises into new `workouts` / `workout_exercises` tables (`b271f23`), tested on a copy of a real snapshot and deployed on the homelab (tables confirmed there). Logged on Complete, not on every edit, so each entry is a real session. The history endpoint and graph were deliberately left for later.
- Found that the homelab crontab still pointed to `/home/youruser/...`, so no nightly backup had ever run. Fixed to `dingo11`, ran it by hand (`dashboard-2026-11-07_1900.db`) and synced it to the PC.

**2026-11-07**
- Rewrote the README for the client-server version: architecture, a "Design decisions" section (one short paragraph each), local setup with the `VITE_API_URL` shell override, Docker deployment, backups, honest limitations and an updated roadmap. Added an MIT `LICENSE`. Screenshots are still missing.
- Added a note to each exercise (`note` column, `NoteField`, full-width line under the row; a card row on the phone). It goes through the existing PATCH endpoint, so no new route. Added `migrate()` because `CREATE TABLE IF NOT EXISTS` doesn't add columns to the homelab's existing database; tested against a copy of a real snapshot.
- The phone kept showing the old version after the deploy, until the home-screen app was re-added. Cause: no `Cache-Control` header, so the browser reused a cached `index.html`. Fixed with `FrontendFiles` (`no-cache` for the page, `immutable` for hashed assets). Both are deployed on the homelab and confirmed with `curl -I`.
- Testing tip: `VITE_API_URL=http://localhost:8000 npm run tauri dev` instead of editing `.env`.

**2026-10-28**
- Paid bills now move to the bottom of the month list (in the order they were ticked); unpaid bills stay ordered by due day. Done in the `ORDER BY` of `load_month`, so the frontend didn't change.
- The finance tile wouldn't open because the homelab was still running a build from before `inactive` existed; `month.inactive.length` threw and React blanked the page. Fixed by rebuilding the container. Lesson: after backend changes, redeploy the homelab before testing the desktop app against it.

**2026-10-27 (finance)**
- Built the finance tile, bills only. Budgets are a different feature (a spending log against a limit) and were left for later. Bills and payments are separate tables; payments store their own amount, so history survives price changes.
- Backend: `bills`/`payments` tables and `/finance/...` endpoints. The client sends the month (`"2026-11"`) because the container runs in UTC. Paid/unpaid are idempotent PUT/DELETE. Every response is the viewed month, including inactive bills.
- Frontend: extracted the tile pattern (`useLiveData`, `Tile`, `previewOf`/`viewOf`) out of `App.tsx` once there were two real tiles, made `request<T>` generic, and added `FinanceView` with add/edit/deactivate/reactivate and `money.ts`. Added a stale-refresh guard to `useLiveData` after confirming a slow background refresh could undo a just-ticked bill.
- Made changes go out one at a time (a promise-chain queue in `request()`), so two fast taps can't have their answers arrive out of order. Chosen over server-side version numbers as the smaller change.
- Confirmed the compose port is configurable via `API_PORT` in the homelab's gitignored `server/.env`, so `git pull` there stays clean.
- Fixed a CSS typo (`overflow-y: auto:`) that stopped the expanded view from scrolling itself.

**2026-10-27**
- Brought this file up to date with the delete button (`7c30c86`, 2026-10-23), which was committed before these notes were written but missing from them.
- Restored deleting exercises from the pool. It existed in the old local-SQLite version (`639f305`) but was lost in the move to the API (`3ff03e2`). Re-added as a `DELETE` endpoint, `deleteExercise()` in `data.ts`, and a two-click ✕ button. Only pool exercises can be deleted, so nothing in today's workout disappears by accident.
- Renamed `claude.md` to `CLAUDE.md` so Claude Code loads it automatically, and added the `/handoff` command.
