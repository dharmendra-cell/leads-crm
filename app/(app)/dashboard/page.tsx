"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LeadTable from "@/components/LeadTable";
import FilterBar from "@/components/FilterBar";
import ClassifyRemarks from "@/components/ClassifyRemarks";
import { DIMENSIONS, DIM_LABEL, statusLabel, type Dimension } from "@/lib/constants";

interface Bucket { key: string; count: number }
interface Prog { key: string; total: number; notCalled: number; notPicked: number; connected: number; pending: number; attempts: number }
interface Stats {
  kpis: { total: number; contacted: number; interested: number; won: number; dueToday: number; hotUntouched: number };
  breakdowns: Record<Dimension, Bucket[]>;
  progress: Prog[];
  progressBy: Dimension;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtKey = (d: Dimension, v: string) =>
  d === "status" ? statusLabel(v) : d === "month" ? `${MONTHS[+v.slice(5, 7) - 1]} ${v.slice(0, 4)}` : d === "day" ? `${+v.slice(8, 10)} ${MONTHS[+v.slice(5, 7) - 1]} ${v.slice(2, 4)}` : v;

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [stats, setStats] = useState<Stats | null>(null);
  const by = ((DIMENSIONS as readonly string[]).includes(sp.get("by") ?? "") ? sp.get("by") : "source") as Dimension;

  // Drill path = dimension filters in the order the user applied them (URL order).
  const keys = [...sp.keys()];
  const path = DIMENSIONS.filter((d) => sp.get(d)).sort((a, b) => keys.indexOf(a) - keys.indexOf(b)).map((d) => [d, sp.get(d)!] as [Dimension, string]);
  const due = sp.get("due") === "1";
  const qs = sp.toString();
  const statsQs = qs;

  const load = useCallback(async () => setStats(await (await fetch(`/api/stats?${statsQs}`)).json()), [statsQs]);
  useEffect(() => { load(); }, [load]);

  const go = (p: URLSearchParams) => router.push(`/dashboard?${p}`);
  const drill = (dim: Dimension, key: string) => {
    const p = new URLSearchParams(qs);
    p.set(dim, key);
    // A month drill supersedes an explicit date range; picking a day inside a month keeps the month crumb.
    if (dim === "month") { p.delete("from"); p.delete("to"); p.delete("day"); }
    go(p);
  };
  const dropTo = (i: number) => {
    const p = new URLSearchParams(qs);
    path.slice(i).forEach(([d]) => p.delete(d));
    go(p);
  };
  const setBy = (d: Dimension) => { const p = new URLSearchParams(qs); p.set("by", d); go(p); };
  const k = stats?.kpis;

  // Cards for every dimension not already pinned. Day only appears once a month/range is chosen.
  const cards = DIMENSIONS.filter((d) => !sp.get(d) && !(d === "month" && sp.get("day")) && (d !== "day" || (stats?.breakdowns.day.length ?? 0) > 0));
  const dateBits = [sp.get("from") && `from ${sp.get("from")}`, sp.get("to") && `to ${sp.get("to")}`].filter(Boolean).join(" ");

  return (
    <div className="space-y-5">
      <FilterBar basePath="/dashboard" />
      <ClassifyRemarks onDone={load} />
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button className="text-blue-600 hover:underline" onClick={() => router.push("/dashboard")}>All leads</button>
        {path.map(([d, v], i) => (
          <span key={d} className="flex items-center gap-1">
            <span className="text-gray-400">›</span>
            <button className={i === path.length - 1 ? "font-semibold" : "text-blue-600 hover:underline"} onClick={() => dropTo(i + 1)} title="Click to remove filters after this level">{fmtKey(d, v)}</button>
            <button className="text-gray-400 hover:text-red-600" onClick={() => dropTo(i)} title="Remove this filter">×</button>
          </span>
        ))}
        {dateBits && <span className="ml-2 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs">enquiry {dateBits}</span>}
        {due && <span className="ml-2 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">follow-ups due</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi label="Total leads" value={k?.total} />
        <Kpi label="Contacted" value={k?.contacted} sub={k && pct(k.contacted, k.total)} />
        <Kpi label="Interested" value={k?.interested} sub={k && pct(k.interested, k.total)} />
        <Kpi label="Won" value={k?.won} sub={k && pct(k.won, k.total)} />
        <Kpi label="Follow-ups due" value={k?.dueToday} tone="warn" onClick={() => { const p = new URLSearchParams(qs); p.set("due", "1"); go(p); }} />
        <Kpi label="Hot & untouched" value={k?.hotUntouched} tone="good" />
      </div>

      {stats && <CallProgress rows={stats.progress} by={by} onBy={setBy} onPick={(key) => !sp.get(by) && drill(by, key)} canDrill={!sp.get(by)} />}

      <div className="grid md:grid-cols-2 gap-4">
        {cards.map((d) => (
          <div key={d} className="card p-4">
            <h3 className="text-sm font-semibold mb-3">By {DIM_LABEL[d].toLowerCase()} <span className="text-xs font-normal text-gray-400">- click to drill down</span></h3>
            <Bars buckets={stats?.breakdowns[d] ?? []} label={(key) => fmtKey(d, key)} onPick={(key) => drill(d, key)} scroll={d === "day" || d === "month"} />
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Leads in this view</h2>
        <LeadTable filters={qs} pageSize={10} onChanged={load} showControls />
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone, onClick }: { label: string; value?: number; sub?: string | false; tone?: "warn" | "good"; onClick?: () => void }) {
  const color = tone === "warn" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "";
  return (
    <div className={`card p-3 ${onClick ? "cursor-pointer hover:bg-gray-50" : ""}`} onClick={onClick}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value ?? "-"} {sub && <span className="text-sm font-normal text-gray-400">{sub}</span>}</p>
    </div>
  );
}

function CallProgress({ rows, by, onBy, onPick, canDrill }: { rows: Prog[]; by: Dimension; onBy: (d: Dimension) => void; onPick: (k: string) => void; canDrill: boolean }) {
  const sum = (f: keyof Omit<Prog, "key">) => rows.reduce((a, r) => a + r[f], 0);
  const all: Prog = { key: "All", total: sum("total"), notCalled: sum("notCalled"), notPicked: sum("notPicked"), connected: sum("connected"), pending: sum("pending"), attempts: sum("attempts") };
  const Bar = ({ r }: { r: Prog }) => (
    <div className="flex h-3 rounded overflow-hidden bg-gray-100 min-w-[140px]">
      <div className="bg-emerald-500" style={{ width: `${(r.connected / Math.max(1, r.total)) * 100}%` }} title={`Connected ${r.connected}`} />
      <div className="bg-amber-400" style={{ width: `${(r.notPicked / Math.max(1, r.total)) * 100}%` }} title={`Not picked ${r.notPicked}`} />
      <div className="bg-sky-300" style={{ width: `${(r.pending / Math.max(1, r.total)) * 100}%` }} title={`Remarks not classified ${r.pending}`} />
      <div className="bg-gray-300" style={{ width: `${(r.notCalled / Math.max(1, r.total)) * 100}%` }} title={`Not called ${r.notCalled}`} />
    </div>
  );
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-4 mb-3">
        <h3 className="text-sm font-semibold">Call progress</h3>
        <label className="text-xs text-gray-500 flex items-center gap-2">Split by
          <select className="input w-auto" value={by} onChange={(e) => onBy(e.target.value as Dimension)}>
            {DIMENSIONS.filter((d) => d !== "status").map((d) => <option key={d} value={d}>{DIM_LABEL[d]}</option>)}
          </select>
        </label>
        <span className="text-xs text-gray-500 flex gap-3">
          <span><i className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> Connected</span>
          <span><i className="inline-block w-2 h-2 rounded-sm bg-amber-400" /> Not picked</span>
          <span><i className="inline-block w-2 h-2 rounded-sm bg-sky-300" /> Remarks not classified</span>
          <span><i className="inline-block w-2 h-2 rounded-sm bg-gray-300" /> Not called yet</span>
        </span>
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 text-left sticky top-0 bg-white">
            <tr><th className="py-1">{DIM_LABEL[by].split(" (")[0]}</th><th className="text-right">Available</th><th className="text-right">Called</th><th className="text-right">Connected</th><th className="text-right">Not picked</th><th className="text-right">Not called yet</th><th className="text-right">Unclassified</th><th className="text-right">Total calls</th><th className="pl-4">Split</th></tr>
          </thead>
          <tbody>
            {[all, ...rows].map((r, i) => (
              <tr key={r.key} className={`border-t border-gray-100 ${i === 0 ? "font-semibold" : canDrill ? "cursor-pointer hover:bg-gray-50" : ""}`} onClick={() => i > 0 && onPick(r.key)}>
                <td className="py-1.5">{i === 0 ? "All" : fmtKey(by, r.key)}</td>
                <td className="text-right">{r.total}</td>
                <td className="text-right">{r.total - r.notCalled} <span className="text-gray-400 font-normal">{pct(r.total - r.notCalled, r.total)}</span></td>
                <td className="text-right text-emerald-700">{r.connected}</td>
                <td className="text-right text-amber-700">{r.notPicked} <span className="text-gray-400 font-normal">{pct(r.notPicked, r.total - r.notCalled)}</span></td>
                <td className="text-right text-gray-600">{r.notCalled}</td>
                <td className="text-right text-sky-700">{r.pending}</td>
                <td className="text-right">{r.attempts}</td>
                <td className="pl-4"><Bar r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-2">Not picked % is out of leads already called. Total calls = attempts logged per lead (imported remarks + calls you log here). Rows without an enquiry date are left out of Month/Day splits.</p>
    </div>
  );
}

function Bars({ buckets, label, onPick, scroll }: { buckets: Bucket[]; label: (k: string) => string; onPick: (k: string) => void; scroll?: boolean }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  if (!buckets.length) return <p className="text-sm text-gray-500">No data.</p>;
  return (
    <ul className={`space-y-1.5 ${scroll ? "max-h-72 overflow-y-auto pr-1" : ""}`}>
      {buckets.map((b) => (
        <li key={b.key}>
          <button className="w-full text-left group" onClick={() => onPick(b.key)}>
            <div className="flex justify-between text-sm"><span className="truncate pr-2 group-hover:underline">{label(b.key)}</span><span className="text-gray-500">{b.count}</span></div>
            <div className="h-2 bg-gray-100 rounded"><div className="h-2 rounded bg-indigo-500" style={{ width: `${(b.count / max) * 100}%` }} /></div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() { return <Suspense><Inner /></Suspense>; }
