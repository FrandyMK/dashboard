import { useRef, useState, type KeyboardEvent } from "react";
import {
  addDay,
  addExercise,
  completeWorkout,
  deleteDay,
  deleteExercise,
  reorderExercises,
  selectDay,
  updateExercise,
  type Exercise,
  type ExerciseChanges,
  type GymPlan,
} from "./data";

// The one-line summary shown on the gym tile.
export function gymPreview(plan: GymPlan): string {
  const day = plan.days[plan.nextDayIndex];
  const today = day.exercises.filter((ex) => ex.active);
  if (today.length === 0) return `Next: ${day.name} — no exercises picked`;
  const first = today[0];
  return `Next: ${day.name} — ${first.name} ${first.weight}kg × ${first.reps}`;
}

type Props = {
  plan: GymPlan;
  onChange: (plan: GymPlan) => void;
};

// A number input that only saves when you're done typing (Enter or
// clicking away), so typing "82.5" doesn't send four requests.
function NumberField({
  value,
  step,
  onCommit,
}: {
  value: number;
  step: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);

  function commit() {
    setEditing(false);
    const n = Number(text);
    if (text.trim() === "" || Number.isNaN(n) || n === value) return;
    onCommit(n);
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      value={editing ? text : String(value)}
      onFocus={() => {
        setText(String(value));
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

// A one-line note under an exercise. Like NumberField, it keeps its own text
// while focused and only saves on Enter or clicking away. Escape cancels.
function NoteField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (note: string) => void;
}) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  // Set by Escape, so the blur that follows doesn't save.
  const cancelled = useRef(false);

  function commit() {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const note = text.trim();
    if (note !== value) onCommit(note);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      // Stop the Escape here, so it doesn't also close the whole tile.
      e.stopPropagation();
      cancelled.current = true;
      e.currentTarget.blur();
    }
  }

  return (
    <input
      className="ex-note"
      type="text"
      placeholder="Add a note…"
      maxLength={500}
      value={editing ? text : value}
      onFocus={() => {
        setText(value);
        setEditing(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKey}
    />
  );
}

export default function GymView({ plan, onChange }: Props) {
  const [newName, setNewName] = useState("");
  const [newDayName, setNewDayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Deleting takes two clicks: the first arms the button, the second deletes.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // On the phone, one exercise at a time shows its fields; the rest show only their name.
  const [openExercise, setOpenExercise] = useState<string | null>(null);

  const day = plan.days[plan.nextDayIndex];
  const inWorkout = day.exercises.filter((ex) => ex.active);
  const available = day.exercises.filter((ex) => !ex.active);

  // Every change goes to the server; its answer becomes the new plan.
  async function run(action: () => Promise<GymPlan>) {
    try {
      onChange(await action());
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  function update(ex: Exercise, changes: ExerciseChanges) {
    run(() => updateExercise(day.id, ex.id, changes));
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    run(() => addExercise(day.id, name));
  }

  function remove(id: string) {
    setConfirmDelete(null);
    run(() => deleteExercise(day.id, id));
  }

  function addNewDay() {
    const name = newDayName.trim();
    if (!name) return;
    setNewDayName("");
    run(() => addDay(name));
  }

  function removeDay(id: string) {
    setConfirmDelete(null);
    run(() => deleteDay(id));
  }

  function move(id: string, direction: -1 | 1) {
    const list = [...day.exercises];
    const from = list.findIndex((ex) => ex.id === id);
    const active = list[from].active;

    let to = from + direction;
    while (to >= 0 && to < list.length && list[to].active !== active) {
      to += direction;
    }
    if (to < 0 || to >= list.length) return;

    [list[from], list[to]] = [list[to], list[from]];
    run(() => reorderExercises(day.id, list.map((ex) => ex.id)));
  }

  function headerRow() {
    return (
      <li className="exercise exercise-header">
        <span>Exercise</span>
        <span>Sets</span>
        <span>Reps</span>
        <span>Weight</span>
        <span />
        <span />
        <span />
        <span />
      </li>
    );
  }

  function exerciseRow(ex: Exercise, index: number, total: number) {
    const isOpen = openExercise === ex.id;
    const classes = ["exercise", !ex.active && "available", isOpen && "open"]
      .filter(Boolean)
      .join(" ");

    return (
      <li key={ex.id} className={classes}>
        <button
          className="ex-name"
          aria-expanded={isOpen}
          onClick={() => setOpenExercise(isOpen ? null : ex.id)}
        >
          {ex.name}
          <span className="ex-summary">
            {ex.sets} × {ex.reps} · {ex.weight} kg
          </span>
        </button>

        <div className="ex-details">
          <div className="ex-details-inner">
            <label className="field field-sets">
              <span className="field-label">Sets</span>
              <NumberField value={ex.sets} step={1} onCommit={(sets) => update(ex, { sets })} />
            </label>
            <label className="field field-reps">
              <span className="field-label">Reps</span>
              <NumberField value={ex.reps} step={1} onCommit={(reps) => update(ex, { reps })} />
            </label>
            <label className="field field-weight">
              <span className="field-label">Weight (kg)</span>
              <NumberField
                value={ex.weight}
                step={2.5}
                onCommit={(weight) => update(ex, { weight })}
              />
            </label>
            <span className="unit">kg</span>
            <span className="ex-delete">
              {!ex.active && (
                <button
                  className={confirmDelete === ex.id ? "move delete confirming" : "move delete"}
                  title={confirmDelete === ex.id ? "Click again to delete" : "Delete exercise"}
                  onClick={() =>
                    confirmDelete === ex.id ? remove(ex.id) : setConfirmDelete(ex.id)
                  }
                  onMouseLeave={() => setConfirmDelete(null)}
                  onBlur={() => setConfirmDelete(null)}
                >
                  {confirmDelete === ex.id ? "✓" : "✕"}
                </button>
              )}
            </span>
            <NoteField value={ex.note} onCommit={(note) => update(ex, { note })} />
          </div>
        </div>

        <span className="reorder">
          <button
            className="move"
            title="Move up"
            disabled={index === 0}
            onClick={() => move(ex.id, -1)}
          >
            ▲
          </button>
          <button
            className="move"
            title="Move down"
            disabled={index === total - 1}
            onClick={() => move(ex.id, 1)}
          >
            ▼
          </button>
        </span>
        <button
          className="move toggle"
          title={ex.active ? "Remove from today" : "Add to today"}
          onClick={() => update(ex, { active: !ex.active })}
        >
          {ex.active ? "−" : "+"}
        </button>
      </li>
    );
  }

  return (
    <div className="gym">
      <h2>{day.name}</h2>
      {error && <p className="error">{error}</p>}

      <h3 className="section-title">Today's workout</h3>
      {inWorkout.length === 0 ? (
        <p className="empty">Nothing yet — add exercises from the list below.</p>
      ) : (
        <ul className="exercise-list">
          {headerRow()}
          {inWorkout.map((ex, i) => exerciseRow(ex, i, inWorkout.length))}
        </ul>
      )}

      <details className="pool" key={day.id}>
        <summary className="section-title">
          All {day.name.toLowerCase()} exercises ({available.length})
        </summary>
        {available.length > 0 && (
          <ul className="exercise-list">
            {headerRow()}
            {available.map((ex, i) => exerciseRow(ex, i, available.length))}
          </ul>
        )}

        <div className="add-exercise">
          <input
            placeholder="New exercise name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button onClick={add}>+ Add to list</button>
        </div>
      </details>

      <div className="gym-actions">
        <button onClick={() => run(completeWorkout)}>Complete workout →</button>
      </div>

      <details className="days">
        <summary className="section-title">Workout days ({plan.days.length})</summary>
        <ul className="day-list">
          {plan.days.map((d, i) => (
            <li key={d.id} className="day-row">
              <button
                className="day-name"
                title={i === plan.nextDayIndex ? "This is the next workout" : `Switch to ${d.name}`}
                disabled={i === plan.nextDayIndex}
                onClick={() => run(() => selectDay(d.id))}
              >
                {d.name}
                {i === plan.nextDayIndex && <span className="day-next"> · next</span>}
              </button>
              <span className="day-count">{d.exercises.length} exercises</span>
              {plan.days.length > 1 && (
                <button
                  className={confirmDelete === d.id ? "move delete confirming" : "move delete"}
                  title={
                    confirmDelete === d.id
                      ? "Click again to delete this day and its exercises"
                      : "Delete day"
                  }
                  onClick={() => (confirmDelete === d.id ? removeDay(d.id) : setConfirmDelete(d.id))}
                  onMouseLeave={() => setConfirmDelete(null)}
                  onBlur={() => setConfirmDelete(null)}
                >
                  {confirmDelete === d.id ? "✓" : "✕"}
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="add-exercise">
          <input
            placeholder="New day name, e.g. Calisthenics day"
            value={newDayName}
            onChange={(e) => setNewDayName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNewDay()}
          />
          <button onClick={addNewDay}>+ Add day</button>
        </div>
      </details>
    </div>
  );
}
