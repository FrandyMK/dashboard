import Database from "@tauri-apps/plugin-sql";

export type Exercise = {
  id: string;
  name: string;
  weight: number; // kg — the last weight you used
  sets: number;
  reps: number;
  active: boolean; // true = in today's workout, false = in the pool
};

export type WorkoutDay = {
  id: string;
  name: string;
  exercises: Exercise[];
};

export type GymPlan = {
  days: WorkoutDay[];
  nextDayIndex: number;
};

// Only used the very first time, to fill an empty database.
const SEED_PLAN: GymPlan = {
  nextDayIndex: 0,
  days: [
    {
      id: "push",
      name: "Push day",
      exercises: [
        { id: "bench", name: "Bench press", weight: 80, sets: 3, reps: 5, active: true },
        { id: "ohp", name: "Overhead press", weight: 45, sets: 3, reps: 8, active: true },
        { id: "incline", name: "Incline dumbbell press", weight: 26, sets: 3, reps: 10, active: false },
        { id: "dips", name: "Dips", weight: 0, sets: 3, reps: 10, active: false },
        { id: "lateral", name: "Lateral raise", weight: 10, sets: 3, reps: 12, active: false },
        { id: "pushdown", name: "Tricep pushdown", weight: 25, sets: 3, reps: 12, active: false },
      ],
    },
    {
      id: "pull",
      name: "Pull day",
      exercises: [
        { id: "row", name: "Barbell row", weight: 70, sets: 3, reps: 8, active: true },
        { id: "pullup", name: "Pull-ups", weight: 0, sets: 3, reps: 8, active: true },
        { id: "pulldown", name: "Lat pulldown", weight: 55, sets: 3, reps: 10, active: false },
        { id: "facepull", name: "Face pull", weight: 20, sets: 3, reps: 15, active: false },
        { id: "curl", name: "Bicep curl", weight: 12, sets: 3, reps: 10, active: false },
      ],
    },
    {
      id: "legs",
      name: "Leg day",
      exercises: [
        { id: "squat", name: "Squat", weight: 100, sets: 3, reps: 5, active: true },
        { id: "rdl", name: "Romanian deadlift", weight: 80, sets: 3, reps: 8, active: false },
        { id: "legpress", name: "Leg press", weight: 150, sets: 3, reps: 10, active: false },
        { id: "calf", name: "Calf raise", weight: 60, sets: 3, reps: 15, active: false },
      ],
    },
  ],
};

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

async function initDb(): Promise<Database> {
  const db = await Database.load("sqlite:dashboard.db");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS workout_days (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT NOT NULL,
      day_id TEXT NOT NULL REFERENCES workout_days(id),
      name TEXT NOT NULL,
      weight REAL NOT NULL,
      sets INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      position INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (day_id, id)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Migration: databases created before the pool existed lack the
  // 'active' column. Add it if missing, so existing data is kept.
  const columns = await db.select<{ name: string }[]>(
    "PRAGMA table_info(exercises)"
  );
  if (!columns.some((c) => c.name === "active")) {
    await db.execute(
      "ALTER TABLE exercises ADD COLUMN active INTEGER NOT NULL DEFAULT 1"
    );
  }

  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM workout_days"
  );
  if (rows[0].count === 0) {
    await writePlan(db, SEED_PLAN);
  }

  return db;
}

async function writePlan(db: Database, plan: GymPlan): Promise<void> {
  for (const [dayPos, day] of plan.days.entries()) {
    await db.execute(
      `INSERT INTO workout_days (id, name, position) VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, position = excluded.position`,
      [day.id, day.name, dayPos]
    );
    for (const [exPos, ex] of day.exercises.entries()) {
      await db.execute(
        `INSERT INTO exercises (id, day_id, name, weight, sets, reps, position, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT(day_id, id) DO UPDATE SET
           name = excluded.name, weight = excluded.weight,
           sets = excluded.sets, reps = excluded.reps,
           position = excluded.position, active = excluded.active`,
        [ex.id, day.id, ex.name, ex.weight, ex.sets, ex.reps, exPos, ex.active ? 1 : 0]
      );
    }

    // Remove exercises that are in the database but no longer in the plan.
    const ids = day.exercises.map((ex) => ex.id);
    if (ids.length === 0) {
      await db.execute("DELETE FROM exercises WHERE day_id = $1", [day.id]);
    } else {
      const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
      await db.execute(
        `DELETE FROM exercises WHERE day_id = $1 AND id NOT IN (${placeholders})`,
        [day.id, ...ids]
      );
    }
  }
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('next_day_index', $1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(plan.nextDayIndex)]
  );
}

// SQLite has no true/false, so 'active' comes back as 0 or 1.
type ExerciseRow = Omit<Exercise, "active"> & { day_id: string; active: number };

export async function getGymPlan(): Promise<GymPlan> {
  const db = await getDb();

  const days = await db.select<{ id: string; name: string }[]>(
    "SELECT id, name FROM workout_days ORDER BY position"
  );
  const exercises = await db.select<ExerciseRow[]>(
    "SELECT id, day_id, name, weight, sets, reps, active FROM exercises ORDER BY position"
  );
  const setting = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'next_day_index'"
  );

  return {
    nextDayIndex: setting.length ? Number(setting[0].value) : 0,
    days: days.map((d) => ({
      id: d.id,
      name: d.name,
      exercises: exercises
        .filter((ex) => ex.day_id === d.id)
        .map((ex) => ({
          id: ex.id,
          name: ex.name,
          weight: ex.weight,
          sets: ex.sets,
          reps: ex.reps,
          active: ex.active === 1,
        })),
    })),
  };
}

export async function saveGymPlan(updated: GymPlan): Promise<void> {
  const db = await getDb();
  await writePlan(db, updated);
}
