"use client";
import { useCallback, useEffect, useState } from "react";
import { STATUSES } from "@/lib/constants";
import { fmtDate, fmtDateTime, toInputDate } from "@/lib/format";
import StatusBadge from "./StatusBadge";

interface Interaction { id: string; type: string; outcome: string | null; note: string | null; userName: string | null; createdAt: string }
interface Detail {
  id: string; name: string | null; company: string | null; phone: string | null; altPhone: string | null; email: string | null;
  city: string | null; state: string | null; address: string | null; source: string; status: string; requirement: string | null;
  message: string | null; callAttempts: number; nextFollowUp: string | null; queryDate: string | null; score: number; interactions: Interaction[];
}

export default function LeadDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [lead, setLead] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [alt, setAlt] = useState("");
  const [follow, setFollow] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d: Detail = await (await fetch(`/api/leads/${id}`)).json();
    setLead(d);
    setAlt(d.altPhone ?? "");
    setFollow(toInputDate(d.nextFollowUp));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(j.error ?? "Failed");
    if (j.suggestion) setMsg(j.suggestion);
    setNote("");
    await load();
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        {!lead ? <p className="text-sm text-gray-500">Loading...</p> : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{lead.name || lead.company || lead.phone}</h2>
                {lead.name && lead.company && <p className="text-sm text-gray-600">{lead.company}</p>}
                <p className="text-xs text-gray-500 mt-1">{lead.source} - {[lead.city, lead.state].filter(Boolean).join(", ") || "no location"}</p>
              </div>
              <button className="btn" onClick={onClose}>Close</button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={lead.status} />
              <span className="text-xs text-gray-500">Score {lead.score} - {lead.callAttempts} call attempts</span>
            </div>

            <div className="text-sm space-y-1">
              {lead.phone && <p><a className="text-blue-600 underline" href={`tel:${lead.phone}`}>{lead.phone}</a>{lead.altPhone && <> / <a className="text-blue-600 underline" href={`tel:${lead.altPhone}`}>{lead.altPhone}</a></>}</p>}
              {lead.email && <p><a className="text-blue-600 underline" href={`mailto:${lead.email}`}>{lead.email}</a></p>}
              {lead.requirement && <p><b>Wants:</b> {lead.requirement}</p>}
              {lead.message && <p className="text-gray-600">{lead.message}</p>}
              {lead.queryDate && <p className="text-gray-500 text-xs">Enquiry date {fmtDate(lead.queryDate)}</p>}
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Log call outcome</h3>
              <div className="flex flex-wrap gap-2">
                {STATUSES.filter((s) => s.key !== "NEW").map((s) => (
                  <button key={s.key} disabled={busy} className={`btn ${lead.status === s.key ? "btn-primary" : ""}`}
                    onClick={() => patch({ status: s.key, note: note || undefined, nextFollowUp: follow || undefined })}>{s.label}</button>
                ))}
              </div>
              <textarea className="input" rows={2} placeholder="Note (saved with the outcome)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-gray-500">Next follow-up
                  <input type="date" className="input mt-1" value={follow} onChange={(e) => setFollow(e.target.value)} />
                </label>
                <label className="text-xs text-gray-500">Alternate phone
                  <input className="input mt-1" value={alt} onChange={(e) => setAlt(e.target.value)} onBlur={() => alt !== (lead.altPhone ?? "") && patch({ altPhone: alt || null })} />
                </label>
              </div>
              <div className="flex gap-2">
                <button className="btn" disabled={busy || !note.trim()} onClick={() => patch({ note })}>Save note only</button>
                <button className="btn" disabled={busy} onClick={() => patch({ nextFollowUp: follow || null })}>Save follow-up date</button>
              </div>
              {msg && <p className="text-sm text-amber-700">{msg}</p>}
            </section>

            <section>
              <h3 className="text-sm font-semibold mb-2">History</h3>
              <ul className="space-y-2">
                {lead.interactions.length === 0 && <li className="text-sm text-gray-500">No activity yet.</li>}
                {lead.interactions.map((i) => (
                  <li key={i.id} className="text-sm border-l-2 border-gray-200 pl-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {fmtDateTime(i.createdAt)} {i.userName && `- ${i.userName}`} {i.outcome && <StatusBadge status={i.outcome} />}
                    </div>
                    {i.note && <p>{i.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
