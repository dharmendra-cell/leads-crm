"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shows a banner when imported remarks are still unclassified, and classifies them in batches (100 leads per request)
 * until none are left. Hidden when nothing is pending. `refreshKey` re-checks after an import.
 */
export default function ClassifyRemarks({ refreshKey = 0, onDone }: { refreshKey?: number; onDone?: () => void }) {
  const [pending, setPending] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const stop = useRef(false);

  const check = useCallback(async () => {
    const d = await (await fetch("/api/stats")).json();
    setPending(d.kpis?.pendingRemarks ?? 0);
  }, []);
  useEffect(() => { check(); }, [check, refreshKey]);

  async function run() {
    stop.current = false;
    setRunning(true);
    setMsg("");
    setTotal(pending);
    let stalls = 0;
    for (;;) {
      if (stop.current) break;
      const res = await fetch("/api/leads/classify", { method: "POST" }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) { setMsg(j.error ?? "Classification failed. Try again in a moment."); break; }
      setPending(j.remaining);
      if (j.remaining === 0) { setMsg("All remarks classified."); break; }
      // Rate-limited or model error: nothing classified this round. Wait a little, and give up after a few tries.
      if (j.classified === 0) {
        if (++stalls >= 3) { setMsg(`${j.remaining} remarks could not be classified right now (AI rate limit). Try again in a minute.`); break; }
        await new Promise((r) => setTimeout(r, 15000));
      } else stalls = 0;
    }
    setRunning(false);
    await check();
    onDone?.();
  }

  if (!pending && !running && !msg) return null;
  const done = total ? Math.max(0, total - pending) : 0;
  return (
    <div className="card p-4 flex flex-wrap items-center gap-3 border-sky-300 bg-sky-50">
      <div className="text-sm flex-1 min-w-[240px]">
        {pending > 0 || running ? (
          <><b>{pending}</b> leads have imported remarks that are not classified yet (status shows as New until then). Their remark text is already saved in each lead&apos;s history.</>
        ) : null}
        {running && total > 0 && <div className="mt-2 h-2 rounded bg-sky-100"><div className="h-2 rounded bg-sky-500" style={{ width: `${(done / total) * 100}%` }} /></div>}
        {msg && <div className="mt-1 text-sky-800">{msg}</div>}
      </div>
      {pending > 0 && !running && <button className="btn btn-primary" onClick={run}>Classify remarks with AI</button>}
      {running && <button className="btn" onClick={() => { stop.current = true; }}>Stop</button>}
    </div>
  );
}
