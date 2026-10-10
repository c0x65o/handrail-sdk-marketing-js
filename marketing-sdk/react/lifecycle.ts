import { useEffect, useRef } from "react";

/** One read on entry/return, no hidden or idle polling. Pending work gets at most
 * twelve five-second reads per work identity. A return or explicit read can
 * recover later outcomes. Abort is a stale-result fence, not mutation rollback. */
export function useVisibleRefresh(read: (signal: AbortSignal) => Promise<void>, workKey = "") {
  const latest = useRef(read); latest.current = read;
  const state = useRef({ controller: new AbortController(), flight: null as Promise<void> | null, mounted: false, lastReturn: 0 });
  const refresh = () => {
    const s = state.current;
    if (!s.mounted || document.hidden) return Promise.resolve();
    if (s.flight) return s.flight;
    const controller = s.controller;
    const flight = latest.current(controller.signal).finally(() => { if (s.flight === flight) s.flight = null; });
    s.flight = flight; return flight;
  };
  useEffect(() => {
    const s = state.current; s.mounted = true; s.controller = new AbortController();
    void refresh();
    const resume = () => {
      if (document.hidden) { s.controller.abort(); s.controller = new AbortController(); s.flight = null; return; }
      // visibilitychange + focus + pageshow commonly describe one return.
      if (Date.now() - s.lastReturn < 250) return;
      s.lastReturn = Date.now(); void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume); window.addEventListener("pageshow", resume);
    return () => {
      s.mounted = false; s.controller.abort(); s.flight = null;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume); window.removeEventListener("pageshow", resume);
    };
  }, []);
  useEffect(() => {
    if (!workKey) return;
    let remaining = 12;
    const timer = setInterval(() => {
      if (document.hidden || state.current.flight) return;
      if (--remaining <= 0) clearInterval(timer);
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [workKey]);
  return refresh;
}
