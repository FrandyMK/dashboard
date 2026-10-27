import { useEffect, useRef, useState } from "react";

export type LiveData<T> = {
  data: T | null;
  error: boolean;
  // For data the server just sent back after a change.
  setData: (data: T) => void;
};

// Loads data from the server and keeps it fresh: on start, when the window
// regains focus, when the phone shows the page again, and every minute.
// `load` must be defined outside any component, so it's the same function
// on every render. Otherwise the effect would re-run on every render.
export function useLiveData<T>(load: () => Promise<T>): LiveData<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState(false);

  // Goes up by one every time a refresh starts or new data arrives from a change.
  // A refresh only gets to show its answer if nothing newer has happened since it
  // started; otherwise its answer may be older than what's on screen.
  const latest = useRef(0);

  useEffect(() => {
    function refresh() {
      const mine = ++latest.current;
      load()
        .then((result) => {
          if (mine !== latest.current) return;
          setDataState(result);
          setError(false);
        })
        .catch((err) => {
          if (mine !== latest.current) return;
          console.error(err);
          setError(true);
        });
    }

    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(refresh, 60_000);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [load]);

  function setData(next: T) {
    latest.current++;
    setDataState(next);
    setError(false);
  }

  return { data, error, setData };
}
