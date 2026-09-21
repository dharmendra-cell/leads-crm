"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KNOWN_SOURCES } from "@/lib/constants";

interface PreviewRow { name: string | null; phone: string | null; email: string | null; company: string | null; city: string | null; state: string | null; requirement: string | null; queryDate: string | null; remarks: string | null }
interface Preview { valid: number; invalid: number; duplicatesInPaste: number; notes: string[]; preview: PreviewRow[]; invalidRows: { row: number; reason: string }[] }
interface Added { importId: string; inserted: number; duplicates: number; invalid: number }

const store = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Paste rows copied from Excel / a website; leads are created automatically (Undo available). */
export default function PasteLeads({ onChanged }: { onChanged?: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState("IndiaMART");
  const [auto, setAuto] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<Added | null>(null);
  const seq = useRef(0);

  useEffect(() => { setSource(store.get("paste_source", "IndiaMART")); setAuto(store.get("paste_auto", "1") === "1"); }, []);

  async function call(body: object) {
    const res = await fetch("/api/leads/paste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
    return { ok: res.ok, j };
  }

  async function check(t: string, autoAdd: boolean) {
    const id = ++seq.current;
    setErr(""); setAdded(null);
    if (!t.trim()) { setPreview(null); return; }
    setBusy("Reading pasted rows...");
    const { ok, j } = await call({ text: t, source, dryRun: true });
    if (id !== seq.current) return;
    setBusy("");
    if (!ok) { setPreview(null); return setErr(j.error ?? "Could not read the pasted text."); }
    setPreview(j);
    // Every pasted row is usable and nothing looks doubtful: add straight away.
    if (autoAdd && j.valid > 0 && j.invalid === 0) await add(t);
  }

  async function add(t = text) {
    setBusy("Adding leads...");
    setErr("");
    const { ok, j } = await call({ text: t, source });
    setBusy("");
    if (!ok) return setErr(j.error ?? "Could not add the leads.");
    setAdded(j); setPreview(null); setText("");
    store.set("paste_source", source);
    onChanged?.();
  }

  async function undo() {
    if (!added) return;
    const res = await fetch(`/api/import/${added.importId}`, { method: "DELETE" });
    if (res.ok) { setAdded(null); onChanged?.(); } else setErr("Could not undo.");
  }

  return (
    <div className="card p-5 space-y-3" id="paste">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Paste leads</h2>
        <span className="text-xs text-gray-500">Copy rows from Excel, IndiaMART or a website and paste here. Column order does not matter.</span>
        <label className="ml-auto text-xs text-gray-500 flex items-center gap-2">Source
          <input list="paste-sources" className="input w-40" value={source} onChange={(e) => setSource(e.target.value)} onBlur={() => store.set("paste_source", source)} />
          <datalist id="paste-sources">{KNOWN_SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
      </div>
      <textarea
        className="input font-mono text-xs"
        rows={3}
        placeholder={"Paste here, e.g.\n2026-09-21    07771975883    Imran Gori    Bumtum Diaper B Grade-4000 Pack    Indore, Madhya Pradesh, India    Aayesha Collection    goriimran240@gmail.com"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.trim()) { e.preventDefault(); setText(t); check(t, auto); } }}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); store.set("paste_auto", e.target.checked ? "1" : "0"); }} />Add automatically when I paste</label>
        {!auto && <button className="btn" disabled={!text.trim() || !!busy} onClick={() => check(text, false)}>Preview</button>}
        {busy && <span className="text-indigo-600">{busy}</span>}
        {err && <span className="text-red-600">{err}</span>}
      </div>

      {preview && (
        <div className="space-y-2">
          <p className="text-sm">
            <b>{preview.valid}</b> lead(s) ready{preview.invalid > 0 && <>, <b className="text-amber-700">{preview.invalid}</b> without a phone/email (will be skipped)</>}
            {preview.duplicatesInPaste > 0 && <>, {preview.duplicatesInPaste} repeated in what you pasted</>}.
          </p>
          {preview.notes.map((n, i) => <p key={i} className="text-xs text-amber-700">{n}</p>)}
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-left text-gray-500"><tr><th className="p-1">Name</th><th>Phone</th><th>Product</th><th>City / State</th><th>Company</th><th>Email</th><th>Date</th><th>Remarks</th></tr></thead>
              <tbody>{preview.preview.map((r, i) => (
                <tr key={i} className="border-t"><td className="p-1">{r.name ?? "-"}</td><td>{r.phone ?? "-"}</td><td className="max-w-[200px] truncate">{r.requirement ?? "-"}</td><td>{[r.city, r.state].filter(Boolean).join(", ") || "-"}</td><td>{r.company ?? "-"}</td><td>{r.email ?? "-"}</td><td>{r.queryDate ? new Date(r.queryDate).toLocaleDateString("en-IN") : "-"}</td><td className="max-w-[160px] truncate">{r.remarks ?? "-"}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <button className="btn btn-primary" disabled={!!busy || preview.valid === 0} onClick={() => add()}>Add {preview.valid} lead(s)</button>
        </div>
      )}

      {added && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm flex flex-wrap items-center gap-3">
          <span>
            {added.inserted > 0 ? <>Added <b>{added.inserted}</b> new lead(s).</> : <>No new lead added.</>}
            {added.duplicates > 0 && <> {added.duplicates} already in the CRM (logged as repeat enquiry).</>}
            {added.invalid > 0 && <> {added.invalid} skipped (no phone/email).</>}
          </span>
          <Link className="btn" href="/leads?sort=newest">Open leads</Link>
          {added.inserted > 0 && <button className="btn" onClick={undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}
