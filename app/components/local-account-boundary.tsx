"use client";

import { useEffect, useState, type ReactNode } from "react";
import { resolveLocalAccount, type LocalAccount } from "../../lib/local-account.ts";

export function LocalAccountBoundary({ children }: { children: (user: LocalAccount) => ReactNode }) {
  const [state, setState] = useState<{ status: "checking" | "ready" | "error"; user: LocalAccount; resolved: boolean }>({ status: "checking", user: null, resolved: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let inFlight = false;
    let recheck = false;
    let scheduled = false;
    const check = () => {
      if (disposed) return;
      const version = ++generation;
      setState((previous) => ({ ...previous, status: "checking" }));
      // Serialize checks; a return during an older request invalidates its result.
      if (inFlight) { recheck = true; return; }
      inFlight = true;
      void resolveLocalAccount().then((user) => {
        if (!disposed && version === generation) setState((previous) => ({
          status: "ready",
          user: previous.user?.id === user?.id ? previous.user : user,
          resolved: true,
        }));
      }).catch(() => {
        if (!disposed && version === generation) setState({ status: "error", user: null, resolved: false });
      }).finally(() => {
        inFlight = false;
        if (!disposed && recheck) { recheck = false; check(); }
      });
    };
    const scheduleCheck = () => {
      if (disposed || scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; check(); });
    };
    const onVisible = () => { if (document.visibilityState === "visible") scheduleCheck(); };
    // Normal pageshow is already covered by the initial check. Keep focus
    // checks for account changes in another visible window.
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) scheduleCheck(); };
    check();
    window.addEventListener("focus", scheduleCheck);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.removeEventListener("focus", scheduleCheck);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [retry]);
  return <>
    <div style={{ visibility: state.status === "ready" ? "visible" : "hidden" }}
      inert={state.status !== "ready"} aria-hidden={state.status !== "ready"}>
      {state.resolved && children(state.user)}
    </div>
    {state.status !== "ready" && <main className="signal-page mx-auto max-w-[760px] p-8" role="status"
      style={{ position: "fixed", inset: 0, zIndex: 50 }}>
    <p>{state.status === "checking" ? "正在确认账户状态…" : "暂时无法确认账户，未读取本机资料。"}</p>
    {state.status === "error" && <button onClick={() => setRetry((value) => value + 1)}>重新连接</button>}
    </main>}
  </>;
}
