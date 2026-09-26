import { useState } from "react";
import type { Exercise, GymPlan } from "./data";

type Props = {
  plan: GymPlan;
  onSave: (plan: GymPlan) => void;
};

export default function GymView({ plan, onSave }: Props) {
  const [draft, setDraft] = useState<GymPlan>(plan);
  const [newName, setNewName] = useState("");

  const day = draft.days[draft.nextDayIndex];
  const inWorkout = day.exercises.filter((ex) => ex.active);
  const available = day.exercises.filter((ex) => !ex.active);

  // One function for every kind of edit: weight, active, sets, reps...
  function updateExercise(id: string, changes: Partial<Exercise>) {
    setDraft({
      ...draft,
      days: draft.days.map((d, i) =>
        i !== draft.nextDayIndex
          ? d
          : {
              ...d,
              exercises: d.exercises.map((ex) =>
                ex.id === id ? { ...ex, ...changes } : ex
              ),
            }
      ),
    });
  }

  function addExercise() {
    const name = newName.trim();
    if (!name) return;
    const exercise: Exercise = {
      id: crypto.randomUUID(),
      name,
      weight: 0,
      sets: 3,
      reps: 8,
      active: false,
    };
    setDraft({
      ...draft,
      days: draft.days.map((d, i) =>
        i !== draft.nextDayIndex
          ? d
          : { ...d, exercises: [...d.exercises, exercise] }
      ),
    });
    setNewName("");
  }

  function completeWorkout() {
    const next = {
      ...draft,
      nextDayIndex: (draft.nextDayIndex + 1) % draft.days.length,
    };
    setDraft(next);
    onSave(next);
  }

  return (
    <div className="gym">
      <h2>{day.name}</h2>

      <h3 className="section-title">Today's workout</h3>
      {inWorkout.length === 0 && (
        <p className="empty">Nothing yet — move exercises up from the list below.</p>
      )}
      <ul className="exercise-list">
        {inWorkout.map((ex) => (
          <li key={ex.id} className="exercise">
            <span>{ex.name}</span>
            <span className="exercise-scheme">
              {ex.sets} × {ex.reps}
            </span>
            <input
              type="number"
              step="2.5"
              value={ex.weight}
              onChange={(e) =>
                updateExercise(ex.id, { weight: Number(e.target.value) })
              }
            />
            <span>kg</span>
            <button
              className="move"
              title="Remove from today"
              onClick={() => updateExercise(ex.id, { active: false })}
            >
              ↓
            </button>
          </li>
        ))}
      </ul>

      <h3 className="section-title">All {day.name.toLowerCase()} exercises</h3>
      <ul className="exercise-list">
        {available.map((ex) => (
          <li key={ex.id} className="exercise available">
            <span>{ex.name}</span>
            <span className="exercise-scheme">
              {ex.sets} × {ex.reps}
            </span>
            <input
              type="number"
              step="2.5"
              value={ex.weight}
              onChange={(e) =>
                updateExercise(ex.id, { weight: Number(e.target.value) })
              }
            />
            <span>kg</span>
            <button
              className="move"
              title="Add to today"
              onClick={() => updateExercise(ex.id, { active: true })}
            >
              ↑
            </button>
          </li>
        ))}
      </ul>

      <div className="add-exercise">
        <input
          placeholder="New exercise name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addExercise()}
        />
        <button onClick={addExercise}>+ Add to list</button>
      </div>

      <div className="gym-actions">
        <button onClick={() => onSave(draft)}>Save</button>
        <button onClick={completeWorkout}>Complete workout →</button>
      </div>
    </div>
  );
}
