"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Cfg {
  products: { keyword: string; weight: number }[];
  unmatchedPenalty: number;
  quantityTiers: { min: number; points: number }[];
  locations: { name: string; weight: number }[];
  sources: { source: string; weight: number }[];
  hotThreshold: number;
}
interface Sugg { words: { name: string; count: number }[]; cities: { name: string; count: number }[]; states: { name: string; count: number }[]; sources: { name: string; count: number }[] }

const num = (v: string, d = 0) => (v === "" || v === "-" ? d : Number(v) || 0);

export default function RankingPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [sug, setSug] = useState<Sugg | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { fetch("/api/ranking").then((r) => r.json()).then((d) => { setCfg(d.config); setSug(d.suggestions); }); }, []);
  if (!cfg) return <p className="text-sm text-gray-500">Loading...</p>;
  const set = (patch: Partial<Cfg>) => setCfg({ ...cfg, ...patch });

  async function save(rescore: boolean) {
    setBusy(rescore ? "Saving and re-scoring all leads..." : "Saving..."); setErr(""); setMsg("");
    const res = await fetch("/api/ranking", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const j = await res.json();
    if (!res.ok) { setBusy(""); return setErr(j.error ?? "Save failed"); }
    if (rescore) {
      const r = await fetch("/api/ranking/rescore", { method: "POST" });
      const rj = await r.json();
      setMsg(r.ok ? `Saved. ${rj.leads} leads re-scored (highest score ${rj.top}).` : "Saved, but re-scoring failed. Try 'Save & re-score' again.");
    } else setMsg("Saved. New imports will use these rules; click 'Save & re-score' to update existing leads.");
    setBusy("");
  }

  const has = (list: string[], v: string) => list.some((x) => x.toLowerCase() === v.toLowerCase());
  const Row = ({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) => (
    <div className="flex items-center gap-2">{children}<button className="btn text-red-700" onClick={onRemove} title="Remove">×</button></div>
  );
  const Chip = ({ label, count, onClick, added }: { label: string; count?: number; onClick: () => void; added: boolean }) => (
    <button className={`btn ${added ? "opacity-40" : ""}`} disabled={added} onClick={onClick}>{label}{count ? <span className="text-gray-400"> {count}</span> : null}</button>
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Lead ranking</h1>
        <p className="text-sm text-gray-600 mt-1">Score (0-100) = contact quality (max 45) + how recent (max 10) + your business fit below. Set what matters for your business, then re-score. Higher score = call first (Leads page &quot;Best score first&quot;).</p>
      </div>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">1. Products you sell</h2>
        <p className="text-xs text-gray-500">If the enquiry text (product + message) contains the keyword, add its points (negative to push down). Up to ±30 in total.</p>
        {cfg.products.map((p, i) => (
          <Row key={i} onRemove={() => set({ products: cfg.products.filter((_, k) => k !== i) })}>
            <input className="input" placeholder="keyword e.g. wet wipes" value={p.keyword} onChange={(e) => set({ products: cfg.products.map((x, k) => (k === i ? { ...x, keyword: e.target.value } : x)) })} />
            <input className="input w-24" type="number" min={-30} max={30} value={p.weight} onChange={(e) => set({ products: cfg.products.map((x, k) => (k === i ? { ...x, weight: num(e.target.value) } : x)) })} />
            <span className="text-xs text-gray-500">points</span>
          </Row>
        ))}
        <button className="btn" onClick={() => set({ products: [...cfg.products, { keyword: "", weight: 15 }] })}>+ Add product</button>
        {sug && sug.words.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Common words in your leads (click to add):</p>
            <div className="flex flex-wrap gap-2">{sug.words.map((w) => <Chip key={w.name} label={w.name} count={w.count} added={has(cfg.products.map((p) => p.keyword), w.name)} onClick={() => set({ products: [...cfg.products, { keyword: w.name, weight: 15 }] })} />)}</div>
          </div>
        )}
        <label className="text-sm flex items-center gap-2">Points when the enquiry matches none of the products above:
          <input className="input w-24" type="number" min={-30} max={0} value={cfg.unmatchedPenalty} onChange={(e) => set({ unmatchedPenalty: num(e.target.value) })} />
        </label>
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">2. Order quantity</h2>
        <p className="text-xs text-gray-500">The biggest quantity found in the enquiry (like &quot;3000 Piece&quot;, &quot;50 packs&quot;) earns the highest tier it reaches. Units are not converted, so pick numbers that suit your typical unit.</p>
        {cfg.quantityTiers.map((t, i) => (
          <Row key={i} onRemove={() => set({ quantityTiers: cfg.quantityTiers.filter((_, k) => k !== i) })}>
            <span className="text-sm">at least</span>
            <input className="input w-28" type="number" min={1} value={t.min} onChange={(e) => set({ quantityTiers: cfg.quantityTiers.map((x, k) => (k === i ? { ...x, min: num(e.target.value, 1) } : x)) })} />
            <span className="text-sm">units →</span>
            <input className="input w-24" type="number" min={0} max={15} value={t.points} onChange={(e) => set({ quantityTiers: cfg.quantityTiers.map((x, k) => (k === i ? { ...x, points: num(e.target.value) } : x)) })} />
            <span className="text-xs text-gray-500">points (max 15)</span>
          </Row>
        ))}
        <button className="btn" onClick={() => set({ quantityTiers: [...cfg.quantityTiers, { min: 500, points: 8 }] })}>+ Add tier</button>
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">3. Location</h2>
        <p className="text-xs text-gray-500">Priority cities or states (matched on the lead&apos;s city or state). Use negative points for places you do not serve. Range ±15.</p>
        {cfg.locations.map((l, i) => (
          <Row key={i} onRemove={() => set({ locations: cfg.locations.filter((_, k) => k !== i) })}>
            <input className="input" placeholder="city or state e.g. Indore" value={l.name} onChange={(e) => set({ locations: cfg.locations.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input w-24" type="number" min={-15} max={15} value={l.weight} onChange={(e) => set({ locations: cfg.locations.map((x, k) => (k === i ? { ...x, weight: num(e.target.value) } : x)) })} />
            <span className="text-xs text-gray-500">points</span>
          </Row>
        ))}
        <button className="btn" onClick={() => set({ locations: [...cfg.locations, { name: "", weight: 10 }] })}>+ Add place</button>
        {sug && (sug.cities.length > 0 || sug.states.length > 0) && (
          <div>
            <p className="text-xs text-gray-500 mb-1">From your leads (click to add):</p>
            <div className="flex flex-wrap gap-2">
              {[...sug.states, ...sug.cities].map((c) => <Chip key={c.name} label={c.name} count={c.count} added={has(cfg.locations.map((l) => l.name), c.name)} onClick={() => set({ locations: [...cfg.locations, { name: c.name, weight: 10 }] })} />)}
            </div>
          </div>
        )}
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">4. Source quality</h2>
        <p className="text-xs text-gray-500">Points for each platform, based on how well it converts for you (range ±15).</p>
        {cfg.sources.map((s, i) => (
          <Row key={i} onRemove={() => set({ sources: cfg.sources.filter((_, k) => k !== i) })}>
            <input className="input" placeholder="source e.g. IndiaMART Direct" value={s.source} onChange={(e) => set({ sources: cfg.sources.map((x, k) => (k === i ? { ...x, source: e.target.value } : x)) })} />
            <input className="input w-24" type="number" min={-15} max={15} value={s.weight} onChange={(e) => set({ sources: cfg.sources.map((x, k) => (k === i ? { ...x, weight: num(e.target.value) } : x)) })} />
            <span className="text-xs text-gray-500">points</span>
          </Row>
        ))}
        {sug && sug.sources.length > 0 && (
          <div className="flex flex-wrap gap-2">{sug.sources.map((s) => <Chip key={s.name} label={s.name} count={s.count} added={has(cfg.sources.map((x) => x.source), s.name)} onClick={() => set({ sources: [...cfg.sources, { source: s.name, weight: 5 }] })} />)}</div>
        )}
        <button className="btn" onClick={() => set({ sources: [...cfg.sources, { source: "", weight: 5 }] })}>+ Add source</button>
      </section>

      <section className="card p-5 space-y-2">
        <h2 className="font-semibold">5. &quot;Hot lead&quot; cut-off</h2>
        <label className="text-sm flex items-center gap-2">Score at or above
          <input className="input w-24" type="number" min={1} max={100} value={cfg.hotThreshold} onChange={(e) => set({ hotThreshold: num(e.target.value, 60) })} />
          counts as hot (used for the dashboard&apos;s &quot;Hot &amp; untouched&quot;).
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={!!busy} onClick={() => save(true)}>Save &amp; re-score all leads</button>
        <button className="btn" disabled={!!busy} onClick={() => save(false)}>Save only</button>
        <Link className="btn" href="/leads">Open leads (best score first)</Link>
        {busy && <span className="text-sm text-indigo-600">{busy}</span>}
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
