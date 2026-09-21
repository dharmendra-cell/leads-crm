"use client";
import { useEffect, useState } from "react";
import { KNOWN_SOURCES } from "@/lib/constants";
import ClassifyRemarks from "@/components/ClassifyRemarks";
import PasteLeads from "@/components/PasteLeads";

const FIELDS = ["name", "phone", "altPhone", "email", "company", "city", "state", "address", "requirement", "message", "queryDate", "externalId"] as const;
type Mapping = Record<(typeof FIELDS)[number], string | null> & { feedback: string[] };
interface Step { step: string; status: string; detail: string; ms: number }
interface Sheet {
  name: string; headers: string[]; sample: Record<string, string>[]; totalRows: number; mapping: Mapping;
  sourceGuess: string | null; origin: string; steps: Step[]; include: boolean;
}
interface Imported { inserted: number; duplicates: number; invalid: number; steps: Step[] }
interface SheetState extends Sheet { source: string; open: boolean; busy: boolean; error: string; done: Imported | null }
const icon = (s: string) => ({ ok: "✓", warn: "!", skipped: "-", error: "✗" }[s] ?? "•");

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetState[] | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [history, setHistory] = useState<{ id: string; fileName: string; source: string; inserted: number; duplicates: number; createdAt: string; steps: Step[] }[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const loadHistory = async () => setHistory(await (await fetch("/api/import/history")).json());
  useEffect(() => { loadHistory(); }, []);

  async function upload(f: File) {
    setFile(f); setSheets(null); setErr("");
    setBusy("Reading every sheet and detecting its structure (this can take a few seconds per sheet)...");
    const fd = new FormData(); fd.append("file", f);
    const res = await fetch("/api/import/preview", { method: "POST", body: fd });
    setBusy("");
    const j = await res.json();
    if (!res.ok) return setErr(j.error ?? "Upload failed");
    setSkipped(j.skipped);
    setSheets((j.sheets as Sheet[]).map((s) => ({ ...s, source: s.sourceGuess ?? "", open: false, busy: false, error: "", done: null })));
  }

  const upd = (i: number, patch: Partial<SheetState>) => setSheets((all) => all && all.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  async function deleteImport(h: { id: string; fileName: string; source: string; inserted: number }) {
    const info = await (await fetch(`/api/import/${h.id}`)).json();
    if (info.error) return setErr(info.error);
    const warn = info.withLoggedCalls ? `\n\n${info.withLoggedCalls} of them have calls/notes you logged in this app. Those will be lost too.` : "";
    if (!window.confirm(`Delete "${h.fileName}" (${h.source})?\n\nThis permanently deletes ${info.leads} leads and their call history.${warn}`)) return;
    const res = await fetch(`/api/import/${h.id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok) return setErr(j.error ?? "Delete failed");
    setNotice(`Deleted ${j.deletedLeads} leads from "${h.fileName}".`);
    await loadHistory();
    setRefresh((n) => n + 1);
  }

  async function deleteAll() {
    const info = await (await fetch("/api/data")).json();
    if (!info.leads && !info.imports) return setNotice("There is no data to delete.");
    const typed = window.prompt(`This permanently deletes ALL ${info.leads} leads, their call history, ${info.imports} import records and saved column mappings.\nYour login stays.\n\nType DELETE to confirm:`);
    if (typed !== "DELETE") return;
    const res = await fetch("/api/data", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
    const j = await res.json();
    if (!res.ok) return setErr(j.error ?? "Delete failed");
    setNotice(`Deleted ${j.deletedLeads} leads and ${j.deletedImports} imports.`);
    setSheets((all) => all && all.map((x) => ({ ...x, done: null })));
    await loadHistory();
    setRefresh((n) => n + 1);
  }

  const totals = (sheets ?? []).reduce((t, s) => (s.done ? { n: t.n + 1, inserted: t.inserted + s.done.inserted, dup: t.dup + s.done.duplicates } : t), { n: 0, inserted: 0, dup: 0 });
  const sheetProblem = (s: SheetState) => (!s.source.trim() ? "Enter a source name" : !s.mapping.phone && !s.mapping.email ? "Map a phone or email column" : "");

  // One request per sheet, started by that sheet's own Import button.
  async function importSheet(i: number) {
    if (!file || !sheets) return;
    const s = sheets[i];
    upd(i, { busy: true, error: "" });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("plan", JSON.stringify([{ name: s.name, source: s.source.trim(), mapping: s.mapping, steps: s.steps }]));
    let j: { error?: string; sheets?: Imported[]; totals?: Imported };
    let ok = false;
    try {
      const res = await fetch("/api/import/commit", { method: "POST", body: fd });
      ok = res.ok;
      j = await res.json().catch(() => ({ error: `Server error (${res.status}). Re-importing this sheet is safe: duplicates are skipped.` }));
    } catch {
      j = { error: "Network error. Re-importing this sheet is safe: duplicates are skipped." };
    }
    if (!ok || !j.sheets?.[0]) return upd(i, { busy: false, error: j.error ?? "Import failed" });
    upd(i, { busy: false, open: false, done: j.sheets[0] });
    loadHistory();
    setRefresh((n) => n + 1);
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <h1 className="text-xl font-semibold">Import leads</h1>
      <div className="card p-5">
        <p className="text-sm text-gray-600 mb-3">Upload any IndiaMART / TradeIndia / JustDial / Google Maps / call-sheet workbook (.xlsx, .xls, .csv). Every sheet is analysed separately; you confirm before anything is saved.</p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        {busy && <p className="text-sm text-indigo-600 mt-3">{busy}</p>}
        {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
        {notice && <p className="text-sm text-emerald-700 mt-3">{notice}</p>}
      </div>

      <PasteLeads onChanged={() => { loadHistory(); setRefresh((n) => n + 1); }} />

      <ClassifyRemarks refreshKey={refresh} />

      {sheets && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {sheets.length} sheets found. Review each one and click its own <b>Import</b> button.
            {totals.n > 0 && <> Imported so far: <b>{totals.n}</b> sheet(s), <b>{totals.inserted}</b> new leads, {totals.dup} duplicates.</>}
          </p>
          {skipped.length > 0 && <p className="text-xs text-gray-500">Skipped empty sheets: {skipped.map((s) => s.name).join(", ")}</p>}

          {sheets.map((s, i) => (
            <div key={s.name} className={`card p-4 space-y-3 ${s.done ? "border-emerald-300" : !s.include ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-center gap-3">
                <b className="text-sm">{s.name}</b>
                <span className="text-xs text-gray-500">{s.totalRows} rows - mapped by {s.origin === "none" ? "n/a (no contacts found)" : s.origin}</span>
                <input list="sources" className="input w-44 ml-auto" placeholder="Source" value={s.source} disabled={!!s.done || s.busy} onChange={(e) => upd(i, { source: e.target.value })} />
                <button className="btn" onClick={() => upd(i, { open: !s.open })}>{s.open ? "Hide" : "Review"}</button>
                <button className="btn btn-primary" disabled={s.busy || !!s.done || !!sheetProblem(s)} title={sheetProblem(s)} onClick={() => importSheet(i)}>
                  {s.busy ? "Importing..." : s.done ? "Imported ✓" : "Import this sheet"}
                </button>
              </div>
              {s.busy && <p className="text-xs text-indigo-600">Importing: normalising, reading remarks, removing duplicates...</p>}
              {s.error && <p className="text-xs text-red-600">{s.error}</p>}
              {!s.done && !s.busy && sheetProblem(s) && s.include && <p className="text-xs text-amber-700">{sheetProblem(s)} to enable Import.</p>}
              {s.done && (
                <details>
                  <summary className="text-sm text-emerald-700 cursor-pointer">Imported: +{s.done.inserted} new, {s.done.duplicates} duplicates, {s.done.invalid} without usable contact</summary>
                  <div className="mt-2"><AgentSteps steps={s.done.steps} /></div>
                </details>
              )}
              {s.steps.some((x) => x.status === "warn") && !s.open && <p className="text-xs text-amber-700">{s.steps.filter((x) => x.status === "warn").map((x) => x.detail).join(" | ").slice(0, 220)}</p>}
              {s.open && (
                <>
                  <AgentSteps steps={s.steps} />
                  <div className="grid sm:grid-cols-3 gap-2">
                    {FIELDS.map((f) => (
                      <label key={f} className="text-xs text-gray-500">{f}
                        <select className="input mt-1" disabled={!!s.done || s.busy} value={s.mapping[f] ?? ""} onChange={(e) => upd(i, { mapping: { ...s.mapping, [f]: e.target.value || null } })}>
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
                        return <button key={h} type="button" disabled={!!s.done || s.busy} className={`btn ${on ? "btn-primary" : ""}`} onClick={() => upd(i, { mapping: { ...s.mapping, feedback: on ? s.mapping.feedback.filter((x) => x !== h) : [...s.mapping.feedback, h] } })}>{h}</button>;
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

      {history.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Previous imports</h2>
          <ul className="text-sm divide-y">
            {history.map((h) => (
              <li key={h.id} className="py-2 flex items-start gap-3">
                <details className="flex-1">
                  <summary className="cursor-pointer">{h.fileName} - {h.source} - {h.inserted} new, {h.duplicates} dup - {new Date(h.createdAt).toLocaleDateString("en-IN")}</summary>
                  <div className="mt-2"><AgentSteps steps={h.steps} /></div>
                </details>
                <button className="btn text-red-700 border-red-200 hover:bg-red-50" onClick={() => deleteImport(h)}>Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-5 border-red-200">
        <h2 className="font-semibold text-red-700 mb-1">Danger zone</h2>
        <p className="text-sm text-gray-600 mb-3">Remove every lead, call history, import record and saved column mapping from this workspace so you can start fresh. Your login is not affected.</p>
        <button className="btn text-red-700 border-red-300 hover:bg-red-50" onClick={deleteAll}>Delete all imported data</button>
      </div>
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
