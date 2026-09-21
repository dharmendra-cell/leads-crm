"use client";
import { useCallback, useEffect, useState } from "react";

interface B { key: string; calls: number; uniqueLeads: number; firstCalls: number; followUpCalls: number; notPicked: number; connected: number; interested: number; won: number; lostOrNotInterested: number }
interface Agent { user: string; calls: number; connected: number; notPicked: number; interested: number; uniqueLeads: number }
interface Data { total: B & { uniqueLeads: number }; buckets: B[]; agents: Agent[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (period: string, k: string) => {
  const [y, m, d] = k.split("-");
  if (period === "month") return `${MONTHS[+m - 1]} ${y}`;
  if (period === "week") return `Week of ${+d} ${MONTHS[+m - 1]}`;
  return `${+d} ${MONTHS[+m - 1]} ${y.slice(2)}`;
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const today = () => new Date().toLocaleDateString("en-CA");
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toLocaleDateString("en-CA");

export default function ActivityPage() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [user, setUser] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [agents, setAgents] = useState<string[]>([]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ period, from, to });
    if (user) p.set("user", user);
    const d: Data = await (await fetch(`/api/activity?${p}`)).json();
    setData(d);
    if (!user) setAgents(d.agents.map((a) => a.user));
  }, [period, from, to, user]);
  useEffect(() => { load(); }, [load]);

  const choose = (p: "day" | "week" | "month") => {
    setPeriod(p);
    setFrom(daysAgo(p === "day" ? 29 : p === "week" ? 83 : 364));
    setTo(today());
  };
  const t = data?.total;
  const max = Math.max(1, ...(data?.buckets.map((b) => b.calls) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold">Calling activity</h1>
          <p className="text-sm text-gray-500">Calls you log in the app, by day, week or month.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2 text-xs text-gray-500">
          <div className="flex">
            {(["day", "week", "month"] as const).map((p) => (
              <button key={p} className={`btn ${period === p ? "btn-primary" : ""}`} onClick={() => choose(p)}>{p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly"}</button>
            ))}
          </div>
          <label>From<input type="date" className="input mt-1 w-36" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" className="input mt-1 w-36" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>Caller
            <select className="input mt-1 w-36" value={user} onChange={(e) => setUser(e.target.value)}>
              <option value="">Everyone</option>{agents.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Total calls" value={t?.calls} />
        <Kpi label="Leads called" value={t?.uniqueLeads} hint="each lead once" />
        <Kpi label="First calls" value={t?.firstCalls} />
        <Kpi label="Follow-up calls" value={t?.followUpCalls} hint="already called before" />
        <Kpi label="Connected" value={t?.connected} sub={t && pct(t.connected, t.calls)} tone="good" />
        <Kpi label="Not picked" value={t?.notPicked} sub={t && pct(t.notPicked, t.calls)} tone="warn" />
        <Kpi label="Interested" value={t?.interested} sub={t && pct(t.interested, t.calls)} />
      </div>

      <div className="card p-4">
        <div className="overflow-auto max-h-[28rem]">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 text-left sticky top-0 bg-white">
              <tr><th className="py-1">{period === "day" ? "Day" : period === "week" ? "Week" : "Month"}</th><th className="text-right">Calls</th><th className="text-right">Leads called</th><th className="text-right">First</th><th className="text-right">Follow-up</th><th className="text-right">Connected</th><th className="text-right">Not picked</th><th className="text-right">Interested</th><th className="text-right">Won</th><th className="text-right">Lost / not int.</th><th className="pl-4">Volume</th></tr>
            </thead>
            <tbody>
              {data?.buckets.slice().reverse().map((b) => (
                <tr key={b.key} className="border-t border-gray-100">
                  <td className="py-1.5 whitespace-nowrap">{label(period, b.key)}</td>
                  <td className="text-right font-medium">{b.calls}</td>
                  <td className="text-right">{b.uniqueLeads}</td>
                  <td className="text-right">{b.firstCalls}</td>
                  <td className="text-right">{b.followUpCalls}</td>
                  <td className="text-right text-emerald-700">{b.connected} <span className="text-gray-400">{pct(b.connected, b.calls)}</span></td>
                  <td className="text-right text-amber-700">{b.notPicked}</td>
                  <td className="text-right">{b.interested}</td>
                  <td className="text-right">{b.won}</td>
                  <td className="text-right">{b.lostOrNotInterested}</td>
                  <td className="pl-4"><div className="h-2 w-32 rounded bg-gray-100"><div className="h-2 rounded bg-indigo-500" style={{ width: `${(b.calls / max) * 100}%` }} /></div></td>
                </tr>
              ))}
              {data && data.buckets.length === 0 && <tr><td colSpan={11} className="py-6 text-center text-gray-500">No calls logged in this period yet. Open a lead and log an outcome to start.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.agents.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-2">By caller</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 text-left"><tr><th className="py-1">Caller</th><th className="text-right">Calls</th><th className="text-right">Leads called</th><th className="text-right">Connected</th><th className="text-right">Not picked</th><th className="text-right">Interested</th></tr></thead>
            <tbody>{data.agents.map((a) => (
              <tr key={a.user} className="border-t border-gray-100"><td className="py-1.5">{a.user}</td><td className="text-right">{a.calls}</td><td className="text-right">{a.uniqueLeads}</td><td className="text-right text-emerald-700">{a.connected} <span className="text-gray-400">{pct(a.connected, a.calls)}</span></td><td className="text-right text-amber-700">{a.notPicked}</td><td className="text-right">{a.interested}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="card p-4 text-sm text-gray-600 space-y-1">
        <h2 className="font-semibold text-gray-800">How calls are counted</h2>
        <p>Every outcome you log on a lead (Not picked, Picked, Interested, Follow-up, ...) is <b>one call</b>.</p>
        <p>A <b>follow-up call</b> is a call on a lead that was already called before. It counts <b>+1 in Calls</b> and in <b>Follow-up</b>, but the lead is counted <b>once</b> in Leads called for that day/week/month.</p>
        <p>Saving only a note, or changing only the follow-up date, is <b>not</b> a call. Clicking the same outcome twice counts twice.</p>
        <p>Remarks imported from your sheets have no call date, so they are included in each lead&apos;s total calls (Dashboard) but not in this timeline.</p>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, hint, tone }: { label: string; value?: number; sub?: string | false; hint?: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "";
  return (
    <div className="card p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value ?? "-"} {sub && <span className="text-sm font-normal text-gray-400">{sub}</span>}</p>
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}
