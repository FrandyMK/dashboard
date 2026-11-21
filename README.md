# Dashboard

A personal tile dashboard. Each tile shows a one-line summary and opens into a small app when clicked. On my desktop it lives full-time on its own Hyprland workspace; on my phone it's a home-screen web app I use at the gym.

One React codebase runs in both places, talking to one small FastAPI + SQLite server on my home server over Tailscale. The gym tile is shared: my girlfriend uses it on her phone with her own training plan, and the server tells us apart by our Tailscale logins. Built as a post-graduation portfolio project.

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
- Opening it shows all my training days (push, pull, legs, or whatever I set up), with the next one in the rotation marked. Days can be added, renamed (✎ next to the name in an opened day), deleted and reordered, and the order on screen is the rotation. Exercises can be renamed the same way from their unfolded card. On the phone, swiping a day left reveals its move and delete buttons, so the card fills the screen the rest of the time.
- Tapping a day opens it. Each day has a pool of every exercise I can do that day, collapsed by default to keep the screen calm. Exercises move into and out of today's workout without losing their sets, reps or last weight.
- Sets, reps and weight are editable in place, and each exercise has a one-line note ("keep a straight back next time").
- Reorder exercises, add new ones to the pool, and delete pool exercises (two clicks, so nothing disappears by accident).
- "Complete workout" saves a log of that session (each exercise's sets, reps, weight and note, with the date), makes the day after it the next one, and goes back to the list of days. Changing a weight later never rewrites past sessions, so the long-term progression is kept.
- A short recap of the last session sits above the days, written by a local LLM on the home server: "Squat has been at 120 kg for five sessions in a row." It compares each exercise with my earlier sessions and appears within a minute of completing.
- On the phone, each exercise is a collapsed card showing its name, a short "3 × 8 · 80 kg" summary and the move buttons. Tapping the name slides it open to edit the sets, reps, weight and note.

**Monthly bills**
- The tile shows "4 of 7 paid · € 420,00 still due".
- Flip between months with ‹ ›, and jump back with "This month". Past months show what was paid then; ticking a bill in a future month pays ahead.
- Tick a bill off for the month; paid bills move to the bottom in the order they were ticked. Overdue bills show their due date in red.
- Add, edit and deactivate bills. Deactivated bills can be brought back.
- Payment history is kept per month, with the amount that was actually paid.

**Several people**
- Everyone on the tailnet who has been added gets their own gym plan: their own days, exercises, "next day" and workout log. Nobody can see or change anyone else's.
- The finance tile is only for me. Others don't see it, and the server refuses their finance requests too.
- No passwords or login screen: the server knows who is asking from their Tailscale login.

**Everywhere**
- Changes save immediately; there's no Save button.
- Every device stays in sync: the dashboard refreshes on focus, when the phone wakes up, and once a minute.
- A mobile layout with card rows, collapsible exercise cards, swipeable day cards, 16px inputs and large tap targets.

## Architecture

```
Desktop (Tauri app, workspace 5) ──┐
My phone (browser, home screen) ───┼──► tailscale serve ──► FastAPI ──► SQLite
Her phone (browser, home screen) ──┘    (HTTPS, adds      (Docker, only on
                                         who is asking)    127.0.0.1)
                                                         │        │
                                     Ollama (local LLM) ◄┘        │
                                              nightly backup ──► pulled to my PC
```

- **Frontend:** React + TypeScript, built with Vite. It's a plain web app with no Tauri-specific code, so the same build runs in both places.
- **Desktop:** a [Tauri v2](https://v2.tauri.app) window, far lighter than Electron for an app that's always open. A Hyprland window rule pins it to workspace 5.
- **Phone:** the API container also serves the built frontend, so the phone just opens `https://homelab1.<tailnet>.ts.net`.
- **Backend:** FastAPI, Pydantic and plain `sqlite3`, managed with [uv](https://docs.astral.sh/uv/), running in Docker on an Ubuntu home server.
- **LLM:** [Ollama](https://ollama.com) in its own container on the same server, running `qwen3:4b-instruct` on the CPU. The API calls it over HTTP; nothing leaves the house.
- **Network:** every device is on my [Tailscale](https://tailscale.com) tailnet. The API container only listens on `127.0.0.1`; [`tailscale serve`](https://tailscale.com/kb/1312/serve) is the only way in, and adds HTTPS and the identity of whoever is asking. An access rule lets other people's devices reach the dashboard and nothing else on my tailnet.

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
├── llm.py              One small function that asks the local LLM
├── recap.py            Writes the workout recap in the background
├── backup.py           Safe database snapshot
├── add_user.py         Add a person, with empty Push / Pull / Leg days
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

**Workouts are logged as snapshots on "Complete".** The plan (`exercises`) only holds what to do next time, so a weight change overwrites it. Completing a workout copies that day's active exercises into a `workouts` / `workout_exercises` log first. Logging on Complete instead of on every edit keeps typos and corrections out of the history, so each entry is a session that actually happened. Like payments, each entry stores its own exercise name and numbers, with no foreign key to the plan, so renaming or deleting an exercise later doesn't touch the past. At a few sessions a week it grows by roughly 100 KB a year, so nothing is ever pruned.

**The client chooses the month.** The container runs in UTC, so in the Netherlands the server's "this month" would start an hour late (two in summer). Each device sends its own local month, like `2026-11`, and the tile rolls over to the new month by itself.

**Bills have a start month.** Without one, a bill added in November would show up as unpaid (and overdue) in every earlier month. Each bill stores the first month it applies to, and a month shows active bills that have started, plus anything actually paid that month. A new bill starts in the month I'm looking at, which is also how I schedule a bill ahead: flip to December, add it there. Existing bills got their start month from their first payment when the column was added.

**Browsing months doesn't break the rollover.** The finance tile keeps the month it shows as "a specific month" or "the current month". Only the second asks the device for today's month on every refresh, so on the 1st the tile moves on by itself. Closing the tile resets it to the current month, so the summary on the grid is always about now. The ‹ › arrows step from the month that's actually on screen, so two quick taps never skip a month I haven't seen.

**Idempotent paid/unpaid.** Marking paid is a `PUT` and unpaid is a `DELETE` on the same URL, and doing either twice is harmless. A repeated tap or a retried request can't create a second payment or overwrite the first one's timestamp.

**Opening a day doesn't change the rotation.** The server stores which day is next, and only "Complete workout" moves it on, to the day after the one I completed. Opening leg day to look at it, or doing days out of order, never changes anything by accident. Older desktop builds that send "Complete" without a day still get the old behaviour (complete whichever day is next), so the server and the apps can be updated separately.

**The next day is a position, so it's corrected on every change to the list.** The next day is stored as an index into the ordered list of days. Deleting a day before it would shift it onto the wrong day, so deleting moves it back by one, and reordering looks up the same day again in its new position. Storing the day's id instead would avoid these corrections, but it would mean migrating the live database, and the corrections only live in two functions.

**Swipe without JavaScript.** On the phone each day row is a sideways-scrolling strip with CSS scroll snapping: the card is exactly the screen's width, and the ▲▼ ✕ sit just past it. Swiping snaps to either the card or the buttons, with the phone's own scrolling physics and no touch-event code. On the desktop the buttons' wrapper is `display: contents`, so they're ordinary cells of the row.

**Deactivate instead of delete.** Bills are never deleted, only deactivated, so their payment history stays intact and a mistake is one click to undo. Exercises in the pool and whole training days *can* be deleted, but only with a two-click confirm; deleting a day keeps its logged workouts, which store their own copies of the names.

**Migrations at startup.** `CREATE TABLE IF NOT EXISTS` doesn't add new columns to an existing table. So when a column is added (like the exercise note), startup checks `PRAGMA table_info` and runs `ALTER TABLE` if the column is missing. The live database on the server upgrades itself on the next deploy.

**Collapsible cards without changing the desktop layout.** On the phone, an exercise's fields sit in a wrapper that slides open by animating a grid row from `0fr` to `1fr` (browsers can't animate `height: auto`). On the desktop, the same wrappers are `display: contents`, so their children stay cells of the row's 8-column grid, and `order` puts the cells back in their usual place.

**Cache headers for the phone.** Without a caching instruction, the phone's home-screen app kept showing an old version after a deploy. `index.html` is now served with `Cache-Control: no-cache` (the browser checks with the server every time). The built JavaScript and CSS files have a content hash in their names, so they're cached forever.

**Identity comes from Tailscale, in exactly one place.** Everyone already needs Tailscale to reach the server, and Tailscale already knows whose device sent each request. So instead of building passwords and sessions, `tailscale serve` puts the sender's login in a `Tailscale-User-Login` header, and one FastAPI dependency, `current_user()`, looks that login up in a `users` table. That only works because the container listens on `127.0.0.1`: if the API port were reachable directly, anyone could send that header themselves. Every route only ever sees a user id, so moving to real logins later (passkeys, or OAuth for friends without Tailscale) means changing that one function, not the data or the routes.

**Who gets what is decided by the server.** Finance routes sit on their own `APIRouter` with a dependency that answers 403 for anyone but me, so a finance route added later can't forget the check. The frontend asks `/me` first and leaves out the tiles someone can't use, but that's only to keep their screen clean; the server would refuse anyway. 401 means "I don't know who you are", 403 means "I know, and you're not allowed".

**Per-person data through the day.** Training days have a `user_id`; exercises don't need one, because they belong to whoever owns their day. Every gym function takes the user's id and checks the day first, so guessing someone else's day id gets a 404. The "next day" moved from a global setting to each user's row. A new person starts with empty Push / Pull / Leg days to fill in themselves (new exercises start at 0 kg), so nobody starts out with someone else's numbers. Their days get random ids rather than readable ones like `push`, because day ids are unique across everyone and the workout log looks exercises up by id. The migration gave every existing day and logged workout to me, and my login comes from `server/.env` (refreshed on every start), so it isn't in this public repo.

**Numbers in code, words from the LLM.** The workout recap comes from a 4-billion-parameter model running on the home server's CPU. Small models get arithmetic and facts wrong, so the model never sees the raw log: `progress_facts()` in `db.py` compares each exercise with that person's last four sessions and writes plain facts ("Squat: 2 x 5 at 120 kg, same weight for at least 5 sessions in a row"), and the model only turns them into a sentence or two. A low temperature and a prompt that forbids new numbers keep it close to those facts. The history query filters on the person's id, so nobody's recap is built from someone else's training.

**The LLM never makes anyone wait.** On this CPU the model writes about 10 words a second and needs up to 15 seconds to load, so a recap takes around 15 seconds. "Complete workout" returns at once and hands the recap to a FastAPI background task, which saves it on the workout's log when it's done. The existing refresh (on focus and every minute) picks it up, so there's no extra polling or streaming. If the model is down, the request fails quietly and the log simply has no recap; nothing else depends on it. Because everything runs locally, my training data and (in future features) my finances never go to a cloud API.

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
DASHBOARD_DEV_USER=owner@localhost uv run fastapi dev main.py

# Terminal 2: the desktop app, pointed at the local API
VITE_API_URL=http://localhost:8000 npm run tauri dev
```

The first Tauri run compiles the Rust side and takes a few minutes. The UI hot-reloads on save, and the interactive API docs are at `http://localhost:8000/docs`.

Locally there's no `tailscale serve` to say who is asking, so `DASHBOARD_DEV_USER` stands in for the missing header. `owner@localhost` is the owner's login when `DASHBOARD_OWNER_LOGIN` isn't set. It's never set on the server, where the header is the only way in.

`VITE_API_URL` is baked in at build time. For everyday use, a root `.env` (see `.env.example`) points it at the home server. Setting it in the shell, as above, overrides the file for that one run.

## Deployment

### Server (Docker)

The Dockerfile is multi-stage: a Node stage builds the frontend, and a Python stage runs the API and serves that build. The compose file stores the database in `server/data/` and reads its settings from `server/.env` (gitignored, machine-specific):

```bash
# server/.env on the home server
BIND_ADDRESS=127.0.0.1                     # only tailscale serve can reach it
API_PORT=8010
DASHBOARD_OWNER_LOGIN=<my Tailscale login>  # see `tailscale whois <my PC's Tailscale IP>`
DASHBOARD_OWNER_NAME=<my name>
```

Without a `.env`, it binds to `127.0.0.1:8000`, so it's never exposed by accident. Once, on the server, put Tailscale in front of it (needs MagicDNS and HTTPS certificates turned on in the Tailscale admin console):

```bash
sudo tailscale serve --bg http://127.0.0.1:8010   # https://homelab1.<tailnet>.ts.net
```

Deploying an update:

```bash
cd ~/dashboard/server && git pull && docker compose up -d --build
```

Adding a person: invite them to the tailnet, give them an access rule that only allows the dashboard server, and add them with their login exactly as Tailscale shows it (the Users page in the admin console):

```bash
docker compose exec api python add_user.py <their login> "<their name>"
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

With Tailscale connected, open `https://homelab1.<tailnet>.ts.net` in the browser and add it to the home screen.

## Backups

- `server/backup.py` uses SQLite's backup API, which makes a consistent copy even while the API is writing. It then runs `PRAGMA integrity_check` and keeps the newest 14 snapshots.
- A cron job on the server runs it nightly inside the container: `docker compose exec -T api python backup.py`.
- A systemd user timer on my PC pulls the snapshots with rsync, after boot and every morning, and keeps all of them.
- **Restore** (tested): `docker compose down`, copy a snapshot over `data/dashboard.db`, `docker compose up -d`.

## Limitations

These are known and deliberate for now:

- **Everyone needs Tailscale.** Identity comes from Tailscale logins, so each person has to be invited to my tailnet. Fine for a few people I know; anyone beyond that would need real logins, which only means replacing `current_user()`.
- **People are added from the command line**, with `add_user.py`. There's no screen for it, and no way to remove someone or change their access other than SQL.
- **No offline support.** The phone needs a connection, and requests have no timeout yet, so with bad signal one hanging change holds up the ones after it.
- **Backups stay in the house** (server and PC). Off-site backup is still to do.
- **Marking a bill paid always records its current amount**, which doesn't suit bills that vary month to month. A bill's start month also can't be changed in the app.
- **Workout history is mostly not shown yet.** Every completed session is logged, and the recap compares the latest one with earlier sessions, but there's no progression graph in the app yet. The data can be analysed straight from a database snapshot. Pressing "Complete workout" without training also logs a session, and there's no way to remove one from the app.

## Roadmap

- [x] Desktop window pinned to a Hyprland workspace
- [x] Gym tile: exercise pool, rotation, editable sets/reps/weight, notes
- [x] Move the backend to a home server; phone version over Tailscale
- [x] Nightly backups with a tested restore
- [x] Finance tile: monthly bills and payment history
- [x] Workout history log
- [ ] To-do tile
- [ ] Habit tracker tile
- [x] Finance: switch between months
- [x] Gym: add, delete and reorder training days
- [x] Gym: rename training days and exercises
- [x] Share the gym tile: one plan per person, identity from Tailscale
- [x] Gym: LLM-written recap of the last session, from a local model
- [ ] Finance: custom amount when marking paid
- [ ] Progression graphs in the gym tile
- [ ] Offline support for the phone, queuing changes until there's signal
- [ ] Follow the active Omarchy theme colours automatically

## License

[MIT](LICENSE)
