import { useEffect, useState, type ReactNode } from "react";
import "./App.css";
import { getGymPlan } from "./data";
import GymView, { gymPreview } from "./GymView";
import { useLiveData, type LiveData } from "./useLiveData";

// Everything the grid and the expanded view need to know about a tile.
// A tile without a view is still a placeholder.
type Tile = {
  id: string;
  title: string;
  preview: string;
  view?: () => ReactNode;
};

function previewOf<T>(source: LiveData<T>, describe: (data: T) => string): string {
  if (source.error) return "Can't reach the server";
  if (source.data === null) return "Loading…";
  return describe(source.data);
}

function viewOf<T>(source: LiveData<T>, render: (data: T) => ReactNode): ReactNode {
  if (source.data === null) {
    return <p className="empty">{source.error ? "Can't reach the server" : "Loading…"}</p>;
  }
  return render(source.data);
}

function App() {
  const [openTile, setOpenTile] = useState<string | null>(null);
  const gym = useLiveData(getGymPlan);

  const tiles: Tile[] = [
    {
      id: "gym",
      title: "Gym",
      preview: previewOf(gym, gymPreview),
      view: () => viewOf(gym, (plan) => <GymView plan={plan} onChange={gym.setData} />),
    },
    { id: "todo", title: "To-do", preview: "3 tasks left today" },
    { id: "finance", title: "Finance", preview: "Groceries: 50/250" },
    { id: "habits", title: "Habits", preview: "4 / 6 done today" },
  ];

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && openTile) {
        setOpenTile(null);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openTile]);

  if (openTile) {
    const tile = tiles.find((t) => t.id === openTile)!;
    return (
      <main className="expanded">
        <button className="back" onClick={() => setOpenTile(null)}>
          ← Back
        </button>
        <h1>{tile.title}</h1>
        {tile.view ? tile.view() : <p>This is where the {tile.title} app will live.</p>}
      </main>
    );
  }

  return (
    <main className="dashboard">
      {tiles.map((tile) => (
        <button className="tile" key={tile.id} onClick={() => setOpenTile(tile.id)}>
          <h2>{tile.title}</h2>
          <p>{tile.preview}</p>
        </button>
      ))}
    </main>
  );
}

export default App;
