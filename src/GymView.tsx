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

  function moveExercise(id: string, direction: -1 | 1) {
    setDraft({
      ...draft,
      days: draft.days.map((d, i) => {
        if (i !== draft.nextDayIndex) return d;
        const list = [...d.exercises];
        const from = list.findIndex((ex) => ex.id === id);
        const active = list[from].active;

        let to = from + direction;
        while (to >= 0 && to < list.length && list[to].active !== active) {
          to += direction;
        }
        if (to < 0 || to >= list.length) return d;

        [list[from], list[to]] = [list[to], list[from]];
        return { ...d, exercises: list };
      }),
    });
  }

  function completeWorkout() {
    const next = {
      ...draft,
      nextDayIndex: (draft.nextDayIndex + 1) % draft.days.length,
    };
    setDraft(next);
    onSave(next);
  }

  function numberInput(
    value: number,
    step: number,
    onChange: (n: number) => void
  ) {
    return (
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }

  function headerRow() {
    return (
      <li className="exercise exercise-header">
        <span>Exercise</span>
        <span title="Sets">Sets</span>
        <span title="Reps">Reps</span>
        <span>Weight</span>
        <span />
        <span />
        <span />
      </li>
    );
  }

  function exerciseRow(ex: Exercise, index: number, total: number) {
    return (
      <li key={ex.id} className={ex.active ? "exercise" : "exercise available"}>
        <span>{ex.name}</span>
        {numberInput(ex.sets, 1, (sets) => updateExercise(ex.id, { sets }))}
        {numberInput(ex.reps, 1, (reps) => updateExercise(ex.id, { reps }))}
        {numberInput(ex.weight, 2.5, (weight) =>
          updateExercise(ex.id, { weight })
        )}
        <span>kg</span>
        <span className="reorder">
          <button
            className="move"
            title="Move up"
            disabled={index === 0}
            onClick={() => moveExercise(ex.id, -1)}
          >
            ▲
          </button>
          <button
            className="move"
            title="Move down"
            disabled={index === total - 1}
            onClick={() => moveExercise(ex.id, 1)}
          >
            ▼
          </button>
        </span>
        <button
          className="move"
          title={ex.active ? "Remove from today" : "Add to today"}
          onClick={() => updateExercise(ex.id, { active: !ex.active })}
        >
          {ex.active ? "−" : "+"}
        </button>
      </li>
    );
  }

  return (
    <div className="gym">
      <h2>{day.name}</h2>

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
