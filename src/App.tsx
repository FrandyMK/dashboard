import { useEffect, useState } from "react";
import "./App.css";
import { getGymPlan, saveGymPlan, type GymPlan } from "./data";
import GymView from "./GymView";

const tiles = [
  { id: "gym", title: "Gym", preview: "Next: Push day — Bench 80kg × 5" },
  { id: "todo", title: "To-do", preview: "3 tasks left today" },
  { id: "finance", title: "Finance", preview: "Groceries: 50/250" },
  { id: "habits", title: "Habits", preview: "4 / 6 done today" },
];

function gymPreview(plan: GymPlan | null): string {
  if (!plan) return "Loading…";
  const day = plan.days[plan.nextDayIndex];
  const today = day.exercises.filter((ex) => ex.active);
  if (today.length === 0) return `Next: ${day.name} — no exercises picked`;
  const first = today[0];
  return `Next: ${day.name} — ${first.name} ${first.weight}kg × ${first.reps}`;
}

function App() {
  const [openTile, setOpenTile] = useState<string | null>(null);
  const [gymPlan, setGymPlan] = useState<GymPlan | null>(null);

  useEffect(() => {
    getGymPlan().then(setGymPlan).catch(console.error);
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && openTile) {
        setOpenTile(null);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openTile]);

  async function handleGymSave(updated: GymPlan) {
    await saveGymPlan(updated);
    setGymPlan(updated);
  }

  if (openTile) {
    const tile = tiles.find((t) => t.id === openTile)!;
    return (
      <main className="expanded">
        <button className="back" onClick={() => setOpenTile(null)}>
          ← Back
        </button>
        <h1>{tile.title}</h1>
        {openTile === "gym" && gymPlan ? (
          <GymView plan={gymPlan} onSave={handleGymSave} />
        ) : (
          <p>This is where the {tile.title} app will live.</p>
        )}
      </main>
    );
  }

  return (
    <main className="dashboard">
      {tiles.map((tile) => (
        <button
          className="tile"
          key={tile.id}
          onClick={() => setOpenTile(tile.id)}
        >
          <h2>{tile.title}</h2>
          <p>{tile.id === "gym" ? gymPreview(gymPlan) : tile.preview}</p>
        </button>
      ))}
    </main>
  );
}

export default App;
