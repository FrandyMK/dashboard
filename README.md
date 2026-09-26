# Dashboard

A personal tile dashboard for the Linux desktop. Each tile shows a quick summary at a glance and opens into a small app when clicked. It lives full-time on its own Hyprland workspace, so checking my training plan or to-do list is one keypress away.

Built with Tauri, React and SQLite as a post-graduation portfolio project.

> **Status:** early development. The gym tile is fully working; the other tiles are placeholders.

<!-- Add a screenshot here once the UI settles:
![Dashboard screenshot](docs/screenshot.png)
-->

## Features

**Gym tracker** (working)
- Tile preview shows the next workout day and its first exercise
- Each training day has a pool of every exercise I can do on that day
- Move exercises into or out of today's workout; nothing is ever lost, and each exercise remembers its last weight
- Edit weights in both today's workout and the pool
- Reorder exercises within each list
- "Complete workout" advances the rotation (push → pull → legs → …)
- All data persists locally in SQLite

**Planned:** to-do list, habit tracker, finance overview, workout history with progression graphs.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | [Tauri v2](https://v2.tauri.app) | Native window with a web UI, far lighter than Electron for an always-open app |
| UI | React + TypeScript | Component model fits the tile structure well |
| Storage | SQLite via `tauri-plugin-sql` | Local, zero-config, no server needed |
| Window management | Hyprland (Omarchy) | A window rule pins the dashboard to a dedicated workspace |

## Architecture

```
src/
├── App.tsx        Tile grid; owns app state; switches between grid and expanded views
├── GymView.tsx    Expanded gym tile: edits a draft copy, hands changes back via onSave
├── data.ts        The only module that touches the database
└── App.css        Theme tokens and layout
```

Data flows one way: `data.ts` loads the plan, `App.tsx` holds it and renders the tile preview, `GymView` edits a local draft and calls `onSave`, and `App.tsx` persists through `data.ts` and updates its state.

### Design decisions

**One data module, async from day one.** Components never know where data comes from. They call `getGymPlan()` and `saveGymPlan()`, nothing else. The functions were async even when they only returned in-memory data, so switching to SQLite changed a single file and no component code. The same boundary is what will make moving the backend to a home server a contained change.

**Exercise pool instead of fixed routines.** Each exercise carries an `active` flag rather than days having a fixed list. Moving an exercise out of today's workout just flips the flag, so its weight, sets and reps are kept for next time, and no data is ever deleted.

**Schema migrations.** When the `active` column was added, existing databases were upgraded in place (`PRAGMA table_info` check followed by `ALTER TABLE`) instead of being wiped. `CREATE TABLE IF NOT EXISTS` alone can't evolve an existing table.

**Upserts with parameterised queries.** A single `writePlan` function both seeds an empty database and saves edits, using `INSERT … ON CONFLICT DO UPDATE`. All values go through `$1`-style placeholders, never string concatenation.

**Immutable state updates.** Edits build new objects rather than mutating existing ones, so React reliably detects changes and the screen never drifts from the data.

## Getting started

### Prerequisites (Arch / Omarchy)

```bash
sudo pacman -S --needed base-devel curl wget file openssl \
  webkit2gtk-4.1 libappindicator-gtk3 librsvg nodejs npm rustup
rustup default stable
```

Other distributions: see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

### Run

```bash
git clone <this-repo-url>
cd dashboard
npm install
npm run tauri dev
```

The first run compiles the Rust side and takes a few minutes; later runs are fast. The UI hot-reloads when you save a file.

### Pin it to a workspace (Hyprland)

Hyprland 0.55+ uses Lua config. Add this to your config (on Omarchy, `~/.config/hypr/input.lua` works):

```lua
hl.window_rule({
  match = { class = "dashboard" },
  workspace = "5 silent",
})
```

`silent` opens the window on workspace 5 without switching you there. Check for mistakes with `hyprctl configerrors`, and confirm the window class with `hyprctl clients` while the app is running.

### Data location

The database is stored in the app's config directory, outside the repository, so personal data is never committed. To find it:

```bash
find ~/.config ~/.local/share -name dashboard.db
```

Delete it to reset to the seed data on next launch.

## Roadmap

- [x] Dashboard window pinned to a Hyprland workspace
- [x] Tile grid with click-to-expand and Escape to close
- [x] Gym tile with SQLite persistence
- [x] Exercise pool, reordering, editable weights
- [ ] To-do tile
- [ ] Extract a shared tile abstraction (summary view + expanded view + data source)
- [ ] Habit tracker and finance tiles
- [ ] Workout history log and progression graphs
- [ ] Follow the active Omarchy theme colours automatically
- [ ] Move the backend to a home server, reachable from my phone over Tailscale

## License

<!-- Pick one before making the repo public; MIT is a common default for portfolio projects. -->
