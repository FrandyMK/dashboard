import { useState } from "react";
import type { GymPlan } from "./data";

type Props = {
  plan: GymPlan;
  onSave: (plan: GymPlan) => void;
};

export default function GymView({ plan, onSave }: Props) {
  const [draft, setDraft] = useState<GymPlan>(plan);
  const day = draft.days[draft.nextDayIndex];

  function updateWeight(exerciseId: string, weight: number) {
    setDraft({
      ...draft,
      days: draft.days.map((d, i) =>
        i !== draft.nextDayIndex
          ? d
          : {
              ...d,
              exercises: d.exercises.map((ex) =>
                ex.id === exerciseId ? { ...ex, weight } : ex
              ),
            }
      ),
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

  return (
    <div className="gym">
      <h2>{day.name}</h2>
      <ul className="exercise-list">
        {day.exercises.map((ex) => (
          <li key={ex.id} className="exercise">
            <span>{ex.name}</span>
            <span className="exercise-scheme">
              {ex.sets} × {ex.reps}
            </span>
            <input
              type="number"
              step="2.5"
              value={ex.weight}
              onChange={(e) => updateWeight(ex.id, Number(e.target.value))}
            />
            <span>kg</span>
          </li>
        ))}
      </ul>
      <div className="gym-actions">
        <button onClick={() => onSave(draft)}>Save weights</button>
        <button onClick={completeWorkout}>Complete workout →</button>
      </div>
    </div>
  );
}
