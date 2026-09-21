"use client";
import { useCallback, useEffect, useState } from "react";
import { fmtDate, isOverdue } from "@/lib/format";
import StatusBadge from "./StatusBadge";
import LeadDrawer from "./LeadDrawer";

interface L { id: string; name: string | null; company: string | null; phone: string | null; city: string | null; source: string; status: string; requirement: string | null; score: number; nextFollowUp: string | null; callAttempts: number }

/** `filters` is a query string like "source=IndiaMART&status=INTERESTED". */
export default function LeadTable({ filters, pageSize = 25, showControls = true, onChanged }: { filters: string; pageSize?: number; showControls?: boolean; onChanged?: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("score");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; leads: L[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => setPage(1), [filters, q, sort]);
  const params = useCallback(() => {
    const p = new URLSearchParams(filters);
    if (q) p.set("q", q);
    return p;
  }, [filters, q]);

  const load = useCallback(async () => {
    const p = params();
    p.set("page", String(page)); p.set("pageSize", String(pageSize)); p.set("sort", sort);
    setData(await (await fetch(`/api/leads?${p}`)).json());
  }, [params, page, pageSize, sort]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="card">
      {showControls && (
        <div className="p-3 flex flex-wrap gap-2 items-center border-b border-gray-100">
          <input className="input max-w-xs" placeholder="Search name, company, phone, product..." value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Best score first</option><option value="followup">Follow-up date</option>
            <option value="date">Enquiry date</option><option value="newest">Recently added</option>
          </select>
          <button className="btn" onClick={() => setAdding(true)}>+ Add direct lead</button>
          <a className="btn" href={`/api/leads/export?${params()}`}>Export Excel</a>
          <span className="ml-auto text-sm text-gray-500">{data ? `${data.total} leads` : "..."}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500 bg-gray-50">
            <tr><th className="p-2">Lead</th><th>Phone</th><th>Source</th><th>Wants</th><th>City</th><th>Score</th><th>Status</th><th>Follow-up</th></tr>
          </thead>
          <tbody>
            {data?.leads.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(l.id)}>
                <td className="p-2 max-w-[220px] truncate">{l.name || l.company || "-"}{l.name && l.company && <span className="text-gray-400"> - {l.company}</span>}</td>
                <td className="whitespace-nowrap">{l.phone ?? "-"}</td>
                <td className="whitespace-nowrap">{l.source}</td>
                <td className="max-w-[220px] truncate">{l.requirement ?? "-"}</td>
                <td>{l.city ?? "-"}</td>
                <td><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${l.score >= 70 ? "bg-emerald-100 text-emerald-800" : l.score >= 45 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>{l.score}</span></td>
                <td><StatusBadge status={l.status} /></td>
                <td className={`whitespace-nowrap ${isOverdue(l.nextFollowUp) && !["WON", "LOST", "NOT_INTERESTED"].includes(l.status) ? "text-red-600 font-medium" : ""}`}>{fmtDate(l.nextFollowUp)}</td>
              </tr>
            ))}
            {data && data.leads.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-500">No leads match.</td></tr>}
          </tbody>
        </table>
      </div>
      {data && pages > 1 && (
        <div className="p-3 flex items-center gap-2 justify-end border-t border-gray-100 text-sm">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} / {pages}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {open && <LeadDrawer id={open} onClose={() => setOpen(null)} onChanged={() => { load(); onChanged?.(); }} />}
      {adding && <AddLead onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); onChanged?.(); }} />}
    </div>
  );
}

function AddLead({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", company: "", city: "", requirement: "", source: "Direct" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onClick={onClose}>
      <form className="card p-5 w-full max-w-sm space-y-2" onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => { e.preventDefault(); const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }); r.ok ? onDone() : setErr((await r.json()).error); }}>
        <h3 className="font-semibold">Add direct lead</h3>
        <input className="input" placeholder="Phone *" value={f.phone} onChange={set("phone")} required />
        <input className="input" placeholder="Name" value={f.name} onChange={set("name")} />
        <input className="input" placeholder="Company" value={f.company} onChange={set("company")} />
        <input className="input" placeholder="City" value={f.city} onChange={set("city")} />
        <input className="input" placeholder="Product / requirement" value={f.requirement} onChange={set("requirement")} />
        <input className="input" placeholder="Source" value={f.source} onChange={set("source")} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2 justify-end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Add</button></div>
      </form>
    </div>
  );
}

