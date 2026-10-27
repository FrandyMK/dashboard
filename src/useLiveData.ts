import { useEffect, useState } from "react";

export type LiveData<T> = {
  data: T | null;
  error: boolean;
  setData: (data: T) => void;
};

// Loads data from the server and keeps it fresh: on start, when the window
// regains focus, when the phone shows the page again, and every minute.
// `load` must be defined outside any component, so it's the same function
// on every render. Otherwise the effect would re-run on every render.
export function useLiveData<T>(load: () => Promise<T>): LiveData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    function refresh() {
      load()
        .then((result) => {
          setData(result);
          setError(false);
        })
        .catch((err) => {
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

  return { data, error, setData };
}
