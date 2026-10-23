import { useState } from "react";
import {
  addExercise,
  completeWorkout,
  deleteExercise,
  reorderExercises,
  updateExercise,
  type Exercise,
  type ExerciseChanges,
  type GymPlan,
} from "./data";

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

export default function GymView({ plan, onChange }: Props) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Deleting takes two clicks: the first arms the button, the second deletes.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

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
    return (
      <li key={ex.id} className={ex.active ? "exercise" : "exercise available"}>
        <span className="ex-name">{ex.name}</span>
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
        {ex.active ? (
          <span />
        ) : (
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

      <h3 className="section-title">All {day.name.toLowerCase()} exercises</h3>
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

      <div className="gym-actions">
        <button onClick={() => run(completeWorkout)}>Complete workout →</button>
      </div>
    </div>
  );
}
