import { useCallback, useEffect, useState, type ReactNode } from "react";
import "./App.css";
import { ApiError, currentPeriod, getFinanceMonth, getGymPlan, getMe, type Me } from "./data";
import FinanceView, { financePreview } from "./FinanceView";
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

// First finds out who is looking, then shows their dashboard. The server decides
// who someone is (from their Tailscale login); the page only asks.
function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (me) return;

    function load() {
      getMe()
        .then((result) => {
          setMe(result);
          setProblem(null);
        })
        .catch((err) => {
          console.error(err);
          setProblem(
            err instanceof ApiError && err.status === 401
              ? "This device isn't registered for the dashboard."
              : "Can't reach the server"
          );
        });
    }

    // Until it works, try again whenever the page comes back into view.
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }

    load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me]);

  if (!me) {
    return (
      <main className="dashboard">
        <p className="empty">{problem ?? "Loading…"}</p>
      </main>
    );
  }
  return <Dashboard me={me} />;
}

function Dashboard({ me }: { me: Me }) {
  const [openTile, setOpenTile] = useState<string | null>(null);
  const gym = useLiveData(getGymPlan);

  // The month shown in the finance tile. null means "the current month", asked
  // for again on every refresh, so on the 1st the tile moves on by itself.
  const [financePeriod, setFinancePeriod] = useState<string | null>(null);
  const loadFinance = useCallback(
    () => getFinanceMonth(financePeriod ?? currentPeriod()),
    [financePeriod]
  );
  // Not loaded at all for people without finance access: the server would
  // refuse anyway (403), and the tile is left out of their grid below.
  const finance = useLiveData(loadFinance, me.canFinance);

  // Closing a tile also brings finance back to the current month,
  // so the grid's preview is always about now.
  function closeTile() {
    setOpenTile(null);
    setFinancePeriod(null);
  }

  const allTiles: (Tile & { hidden?: boolean })[] = [
    {
      id: "gym",
      title: "Gym",
      preview: previewOf(gym, gymPreview),
      view: () => viewOf(gym, (plan) => <GymView plan={plan} onChange={gym.setData} />),
    },
    { id: "todo", title: "To-do", preview: "3 tasks left today", hidden: !me.canFinance },
    {
      id: "finance",
      title: "Finance",
      hidden: !me.canFinance,
      preview: previewOf(finance, financePreview),
      view: () =>
        viewOf(finance, (month) => (
          <FinanceView
            month={month}
            onChange={finance.setData}
            onPeriodChange={setFinancePeriod}
          />
        )),
    },
    { id: "habits", title: "Habits", preview: "4 / 6 done today", hidden: !me.canFinance },
  ];
  // To-do and habits are placeholders with made-up numbers, so for now they're
  // only shown to the owner too. They'll get their own per-person rule once real.
  const tiles = allTiles.filter((tile) => !tile.hidden);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && openTile) {
        closeTile();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openTile]);

  if (openTile) {
    const tile = tiles.find((t) => t.id === openTile)!;
    return (
      <main className="expanded">
        <button className="back" onClick={closeTile}>
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
