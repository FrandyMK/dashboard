import { useEffect, useRef, useState } from "react";

export type LiveData<T> = {
  data: T | null;
  error: boolean;
  // For data the server just sent back after a change.
  setData: (data: T) => void;
};

// Loads data from the server and keeps it fresh: on start, when the window
// regains focus, when the phone shows the page again, and every minute.
// `load` must be the same function on every render: defined outside any
// component, or wrapped in useCallback. Otherwise the effect would re-run on
// every render. When it does change (useCallback with a new dependency), the
// effect starts over and loads from the new function.
// With enabled = false it does nothing at all (e.g. a tile this person can't
// see). It's a parameter rather than skipping the hook, because React needs
// the same hooks to run on every render.
export function useLiveData<T>(load: () => Promise<T>, enabled = true): LiveData<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState(false);

  // Goes up by one every time a refresh starts or new data arrives from a change.
  // A refresh only gets to show its answer if nothing newer has happened since it
  // started; otherwise its answer may be older than what's on screen.
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;

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
  }, [load, enabled]);

  function setData(next: T) {
    latest.current++;
    setDataState(next);
    setError(false);
  }

  return { data, error, setData };
}
