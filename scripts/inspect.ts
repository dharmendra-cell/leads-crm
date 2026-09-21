import { readFileSync } from "fs";
import { parseWorkbook, looksLikeLeads } from "../lib/parse";
import { heuristicMap, guessSource, validateByContent } from "../lib/mapping";
import { transformRows } from "../lib/importer";
import { inferStatus } from "../lib/feedback";
for (const f of process.argv.slice(2)) {
  console.log("\n=====", f.split("/").pop());
  const wb = parseWorkbook(readFileSync(f));
  console.log("skipped:", JSON.stringify(wb.skipped));
  for (const sh of wb.sheets) {
    const ok = looksLikeLeads(sh.rows);
    const src = guessSource(sh.name, sh.title, f, sh.headers) ?? "?";
    if (!ok) { console.log(`- [${sh.name}] rows=${sh.rows.length} NOT LEADS (lookup) src=${src}`); continue; }
    const v = validateByContent(heuristicMap(sh.headers, sh.rows), sh.headers, sh.rows); const m = v.mapping; v.notes.length && console.log('    NOTE:', v.notes.join(' ; ').slice(0, 260));
    const t = transformRows(sh.rows, m, src);
    const st: Record<string, number> = {};
    t.leads.forEach((l) => { if (l.feedback.length) { const s = inferStatus(l.feedback) ?? "UNCLEAR"; st[s] = (st[s] || 0) + 1; } });
    const mm = Object.entries(m).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`).join(" ");
    console.log(`- [${sh.name}] src=${src} hdrless=${sh.headerless} rows=${sh.rows.length} valid=${t.leads.length} blank=${t.blank} invalid=${t.invalid.length} dup=${t.dupInFile} fb=${JSON.stringify(st)}\n    ${mm}`);
  }
}
