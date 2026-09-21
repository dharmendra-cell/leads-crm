"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import LeadTable from "@/components/LeadTable";
import FilterBar from "@/components/FilterBar";
import { OTHER_SOURCE, SOURCE_GROUPS, STATUSES, groupOfSource } from "@/lib/constants";

function Inner() {
  const sp = useSearchParams();
  const source = sp.get("source") ?? "";
  const status = sp.get("status") ?? "";
  const due = sp.get("due") === "1";
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Chip counts respect the other active filters (status / due) but not the source filter itself.
  const countQs = (() => {
    const p = new URLSearchParams(sp.toString());
    p.delete("source");
    return p.toString();
  })();
  useEffect(() => {
    fetch(`/api/stats?${countQs}`).then((r) => r.json()).then((d: { breakdowns: { source: { key: string; count: number }[] } }) => {
      const c: Record<string, number> = {};
      for (const b of d.breakdowns.source) c[groupOfSource(b.key)] = (c[groupOfSource(b.key)] ?? 0) + b.count;
      setCounts(c);
    });
  }, [countQs]);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v === null ? p.delete(k) : p.set(k, v));
    return `/leads?${p}`;
  };
  const chip = (active: boolean) => `btn ${active ? "btn-primary" : ""}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Leads</h1>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 w-14">Source</span>
          <Link className={chip(!source)} href={href({ source: null })}>All <small className="opacity-70">{total}</small></Link>
          {[...SOURCE_GROUPS.map((g) => g.key), OTHER_SOURCE].map((k) => (
            <Link key={k} className={chip(source === k)} href={href({ source: k })}>{k} <small className="opacity-70">{counts[k] ?? 0}</small></Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 w-14">Status</span>
          <Link className={chip(!status && !due)} href={href({ status: null, due: null })}>All</Link>
          <Link className={chip(due)} href={href({ due: "1", status: null })}>Follow-ups due</Link>
          {STATUSES.map((s) => <Link key={s.key} className={chip(status === s.key)} href={href({ status: s.key, due: null })}>{s.label}</Link>)}
        </div>
      </div>

      <FilterBar basePath="/leads" />
      <LeadTable filters={sp.toString()} />
    </div>
  );
}
export default function LeadsPage() { return <Suspense><Inner /></Suspense>; }
