"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { KNOWN_SOURCES } from "@/lib/constants";

const FIELDS = ["name", "phone", "altPhone", "email", "company", "city", "state", "address", "requirement", "message", "queryDate", "externalId"] as const;
type Mapping = Record<(typeof FIELDS)[number], string | null> & { feedback: string[] };
interface Step { step: string; status: string; detail: string; ms: number }
interface Sheet {
  name: string; headers: string[]; sample: Record<string, string>[]; totalRows: number; mapping: Mapping;
  sourceGuess: string | null; origin: string; steps: Step[]; include: boolean;
}
interface SheetState extends Sheet { source: string; open: boolean }
interface Result {
  totals: { inserted: number; duplicates: number; invalid: number };
  sheets: { sheet: string; source: string; inserted: number; duplicates: number; invalid: number; steps: Step[] }[];
}

const icon = (s: string) => ({ ok: "✓", warn: "!", skipped: "-", error: "✗" }[s] ?? "•");

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetState[] | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [history, setHistory] = useState<{ id: string; fileName: string; source: string; inserted: number; duplicates: number; createdAt: string; steps: Step[] }[]>([]);
  const loadHistory = async () => setHistory(await (await fetch("/api/import/history")).json());
  useEffect(() => { loadHistory(); }, []);

  async function upload(f: File) {
    setFile(f); setSheets(null); setResult(null); setErr("");
    setBusy("Reading every sheet and detecting its structure (this can take a few seconds per sheet)...");
    const fd = new FormData(); fd.append("file", f);
    const res = await fetch("/api/import/preview", { method: "POST", body: fd });
    setBusy("");
    const j = await res.json();
    if (!res.ok) return setErr(j.error ?? "Upload failed");
    setSkipped(j.skipped);
    setSheets((j.sheets as Sheet[]).map((s) => ({ ...s, source: s.sourceGuess ?? "", open: false })));
  }

  const upd = (i: number, patch: Partial<SheetState>) => setSheets((all) => all && all.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const selected = sheets?.filter((s) => s.include) ?? [];
  const problems = selected.filter((s) => !s.source.trim() || (!s.mapping.phone && !s.mapping.email));

  // One request per sheet: keeps each call well under serverless time limits and shows progress.
  async function commit() {
    if (!file || !sheets) return;
    setErr("");
    const merged: Result = { totals: { inserted: 0, duplicates: 0, invalid: 0 }, sheets: [] };
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      setBusy(`Importing sheet ${i + 1} of ${selected.length}: "${s.name}" (reading feedback, setting statuses, removing duplicates)...`);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("plan", JSON.stringify([{ name: s.name, source: s.source.trim(), mapping: s.mapping, steps: s.steps }]));
      const res = await fetch("/api/import/commit", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
      if (!res.ok) {
        setBusy("");
        setErr(`Stopped at "${s.name}": ${j.error ?? "Import failed"}. Sheets before it were imported; re-uploading is safe (duplicates are skipped).`);
        if (merged.sheets.length) setResult(merged);
        loadHistory();
        return;
      }
      merged.sheets.push(...j.sheets);
      (Object.keys(merged.totals) as (keyof Result["totals"])[]).forEach((k) => (merged.totals[k] += j.totals[k]));
    }
    setBusy("");
    setResult(merged); setSheets(null); loadHistory();
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <h1 className="text-xl font-semibold">Import leads</h1>
      <div className="card p-5">
        <p className="text-sm text-gray-600 mb-3">Upload any IndiaMART / TradeIndia / JustDial / Google Maps / call-sheet workbook (.xlsx, .xls, .csv). Every sheet is analysed separately; you confirm before anything is saved.</p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {busy && <p className="text-sm text-indigo-600 mt-3">{busy}</p>}
        {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
      </div>

      {sheets && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-600">{sheets.length} sheets found, {selected.length} selected ({selected.reduce((a, s) => a + s.totalRows, 0)} rows).</p>
            <button className="btn btn-primary ml-auto" disabled={!!busy || !selected.length || problems.length > 0} onClick={commit}>Import {selected.length} sheet(s)</button>
          </div>
          {problems.length > 0 && <p className="text-sm text-red-600">Fix: {problems.map((p) => p.name).join(", ")} need a source name and a phone or email column (or untick them).</p>}
          {skipped.length > 0 && <p className="text-xs text-gray-500">Skipped empty sheets: {skipped.map((s) => s.name).join(", ")}</p>}

          {sheets.map((s, i) => (
            <div key={s.name} className={`card p-4 space-y-3 ${s.include ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <input type="checkbox" checked={s.include} onChange={(e) => upd(i, { include: e.target.checked })} />
                <b className="text-sm">{s.name}</b>
                <span className="text-xs text-gray-500">{s.totalRows} rows - mapped by {s.origin === "none" ? "n/a (no contacts found)" : s.origin}</span>
                <input list="sources" className="input w-44 ml-auto" placeholder="Source" value={s.source} onChange={(e) => upd(i, { source: e.target.value })} />
                <button className="btn" onClick={() => upd(i, { open: !s.open })}>{s.open ? "Hide" : "Review"}</button>
              </div>
              {s.steps.some((x) => x.status === "warn") && !s.open && <p className="text-xs text-amber-700">{s.steps.filter((x) => x.status === "warn").map((x) => x.detail).join(" | ").slice(0, 220)}</p>}
              {s.open && (
                <>
                  <AgentSteps steps={s.steps} />
                  <div className="grid sm:grid-cols-3 gap-2">
                    {FIELDS.map((f) => (
                      <label key={f} className="text-xs text-gray-500">{f}
                        <select className="input mt-1" value={s.mapping[f] ?? ""} onChange={(e) => upd(i, { mapping: { ...s.mapping, [f]: e.target.value || null } })}>
                          <option value="">- none -</option>
                          {s.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Feedback / remark columns (become call history + status)</p>
                    <div className="flex flex-wrap gap-2">
                      {s.headers.map((h) => {
                        const on = s.mapping.feedback.includes(h);
                        return <button key={h} type="button" className={`btn ${on ? "btn-primary" : ""}`} onClick={() => upd(i, { mapping: { ...s.mapping, feedback: on ? s.mapping.feedback.filter((x) => x !== h) : [...s.mapping.feedback, h] } })}>{h}</button>;
                      })}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full"><thead><tr>{s.headers.map((h) => <th key={h} className="text-left p-1 text-gray-500">{h}</th>)}</tr></thead>
                      <tbody>{s.sample.map((r, k) => <tr key={k} className="border-t">{s.headers.map((h) => <td key={h} className="p-1 max-w-[160px] truncate">{r[h]}</td>)}</tr>)}</tbody></table>
                  </div>
                </>
              )}
            </div>
          ))}
          <datalist id="sources">{KNOWN_SOURCES.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
      )}

      {result && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Import complete</h2>
          <p className="text-sm"><b>{result.totals.inserted}</b> new leads - <b>{result.totals.duplicates}</b> duplicates merged - <b>{result.totals.invalid}</b> without usable contact</p>
          <ul className="text-sm divide-y">
            {result.sheets.map((s) => (
              <li key={s.sheet} className="py-2"><details><summary className="cursor-pointer">{s.sheet} ({s.source}) - +{s.inserted} new, {s.duplicates} dup, {s.invalid} invalid</summary><div className="mt-2"><AgentSteps steps={s.steps} /></div></details></li>
            ))}
          </ul>
          <Link className="btn btn-primary inline-block" href="/dashboard">Open dashboard</Link>
        </div>
      )}

      {history.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Previous imports</h2>
          <ul className="text-sm divide-y">
            {history.map((h) => (
              <li key={h.id} className="py-2"><details><summary className="cursor-pointer">{h.fileName} - {h.source} - {h.inserted} new, {h.duplicates} dup - {new Date(h.createdAt).toLocaleDateString("en-IN")}</summary><div className="mt-2"><AgentSteps steps={h.steps} /></div></details></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AgentSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="text-sm space-y-1 bg-gray-50 rounded-lg p-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2"><span className={s.status === "warn" ? "text-amber-600" : s.status === "error" ? "text-red-600" : "text-emerald-600"}>{icon(s.status)}</span>
          <span><b>{s.step.replace(/_/g, " ")}</b> - {s.detail} <span className="text-gray-400">({s.ms}ms)</span></span></li>
      ))}
    </ol>
  );
}
