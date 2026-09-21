"use client";
import { useState } from "react";

interface Msg { role: "user" | "assistant"; content: string; trace?: { tool: string; args: unknown; rows: number }[] }

const EXAMPLES = [
  "Which source gives the most interested leads?",
  "Indore ke kitne leads abhi tak call nahi hue?",
  "Show follow-ups due today",
  "Leads asking for baby wipes or napkins",
];

export default function AskPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState("");
  const [insBusy, setInsBusy] = useState(false);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ(""); setBusy(true);
    const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history }) });
    const j = await res.json();
    setBusy(false);
    setMsgs((m) => [...m, { role: "assistant", content: res.ok ? j.answer : j.error, trace: j.trace }]);
  }

  async function getInsights() {
    setInsBusy(true);
    const res = await fetch("/api/insights", { method: "POST" });
    const j = await res.json();
    setInsBusy(false);
    setInsights(res.ok ? j.insights : j.error);
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">AI insights</h2>
          <button className="btn btn-primary" onClick={getInsights} disabled={insBusy}>{insBusy ? "Analysing..." : "Generate insights"}</button>
        </div>
        {insights ? <div className="text-sm whitespace-pre-wrap leading-relaxed">{insights}</div> : <p className="text-sm text-gray-500">Compares sources, flags overdue follow-ups and suggests next actions from your live data.</p>}
      </section>

      <section className="card p-5 flex flex-col gap-3 min-h-[420px]">
        <h2 className="font-semibold">Ask your leads</h2>
        <div className="flex-1 space-y-3 overflow-y-auto">
          {msgs.length === 0 && <div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} className="btn text-left" onClick={() => ask(e)}>{e}</button>)}</div>}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <div className={`inline-block rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-full text-left ${m.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100"}`}>{m.content}</div>
              {m.trace && m.trace.length > 0 && <p className="text-xs text-gray-400 mt-1">Used: {m.trace.map((t) => `${t.tool}(${JSON.stringify(t.args)}) → ${t.rows}`).join("; ")}</p>}
            </div>
          ))}
          {busy && <p className="text-sm text-gray-500">Thinking...</p>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="input" placeholder="Ask anything about your leads..." value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-primary" disabled={busy}>Ask</button>
        </form>
      </section>
    </div>
  );
}
