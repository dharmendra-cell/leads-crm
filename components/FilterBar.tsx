"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Date range, state, city and free-text filters stored in the URL so every view (and drill-down) shares them. */
export default function FilterBar({ basePath }: { basePath: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [facets, setFacets] = useState<{ states: string[]; cities: string[] }>({ states: [], cities: [] });
  const state = sp.get("state") ?? "";
  const [q, setQ] = useState(sp.get("q") ?? "");

  useEffect(() => { fetch(`/api/facets?${state ? `state=${encodeURIComponent(state)}` : ""}`).then((r) => r.json()).then(setFacets); }, [state]);
  useEffect(() => setQ(sp.get("q") ?? ""), [sp]);

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    // Narrowing by an explicit date range replaces month/day drill-downs, and vice versa.
    if ("from" in patch || "to" in patch) { p.delete("month"); p.delete("day"); }
    router.push(`${basePath}?${p}`);
  };
  const monthAhead = (n: number) => {
    const d = new Date(); d.setMonth(d.getMonth() - n, 1);
    const first = d.toLocaleDateString("en-CA");
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString("en-CA");
    set({ from: first, to: last });
  };
  const active = ["from", "to", "state", "city", "q", "month", "day"].some((k) => sp.get(k));

  return (
    <div className="card p-3 flex flex-wrap items-end gap-3 text-xs text-gray-500">
      <label>Enquiry from<input type="date" className="input mt-1 w-36" value={sp.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null })} /></label>
      <label>to<input type="date" className="input mt-1 w-36" value={sp.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null })} /></label>
      <div className="flex gap-1">
        <button className="btn" onClick={() => monthAhead(0)}>This month</button>
        <button className="btn" onClick={() => monthAhead(1)}>Last month</button>
      </div>
      <label>State
        <select className="input mt-1 w-40" value={state} onChange={(e) => set({ state: e.target.value || null, city: null })}>
          <option value="">All states</option>{facets.states.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label>City
        <select className="input mt-1 w-40" value={sp.get("city") ?? ""} onChange={(e) => set({ city: e.target.value || null })}>
          <option value="">All cities</option>{facets.cities.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label className="flex-1 min-w-[160px]">Search
        <input className="input mt-1" placeholder="name, company, phone, product" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && set({ q: q || null })} onBlur={() => q !== (sp.get("q") ?? "") && set({ q: q || null })} />
      </label>
      {active && <button className="btn" onClick={() => router.push(basePath)}>Clear all</button>}
    </div>
  );
}
