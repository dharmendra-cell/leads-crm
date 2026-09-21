import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { commitImport, transformRows } from "@/lib/importer";
import { getRankingConfig } from "@/lib/ranking";
import { headerSignature } from "@/lib/mapping";
import { parsePasted } from "@/lib/paste";
import { embedPendingLeads } from "@/lib/embeddings";

export const maxDuration = 60;

const MAX_CHARS = 200_000;
const MAX_ROWS = 500;

/**
 * Create leads from pasted rows. With dryRun=true it only reports what would be created (used for the live preview).
 * The same pipeline as a sheet import (normalise, dedupe, rank, history) runs, recorded as one "Pasted leads" import
 * so it can be undone with Delete.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { text, source, dryRun } = (await req.json().catch(() => ({}))) as { text?: string; source?: string; dryRun?: boolean };
  if (!text?.trim()) return NextResponse.json({ error: "Paste at least one row." }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: "Pasted text is too large. Paste up to 500 rows at a time." }, { status: 413 });

  const parsed = await parsePasted(text);
  if (parsed.rows.length > MAX_ROWS) return NextResponse.json({ error: `Too many rows (${parsed.rows.length}). Paste up to ${MAX_ROWS} at a time.` }, { status: 413 });
  const src = (source ?? "").trim().slice(0, 60) || "Direct";

  if (dryRun) {
    const t = transformRows(parsed.rows, parsed.mapping, src, new Date(), await getRankingConfig(s.oid));
    return NextResponse.json({
      valid: t.leads.length,
      invalid: t.invalid.length,
      duplicatesInPaste: t.dupInFile,
      notes: parsed.notes,
      preview: t.leads.slice(0, 20).map((l) => ({ name: l.name, phone: l.phone, email: l.email, company: l.company, city: l.city, state: l.state, requirement: l.requirement, queryDate: l.queryDate, remarks: l.feedback.join(" | ") || null })),
      invalidRows: t.invalid.slice(0, 10),
    });
  }

  if (!parsed.mapping.phone && !parsed.mapping.email) return NextResponse.json({ error: "Could not find a phone number or email in the pasted text." }, { status: 400 });
  const result = await commitImport({
    orgId: s.oid,
    fileName: "Pasted leads",
    source: src,
    rows: parsed.rows,
    mapping: parsed.mapping,
    signature: headerSignature(["pasted", ...parsed.headers]),
    priorSteps: [{ step: "paste", status: "ok", detail: `${parsed.rows.length} pasted row(s) read${parsed.notes.length ? `; ${parsed.notes.join(" ")}` : ""}`, ms: 0 }],
  });
  void embedPendingLeads(s.oid).catch(() => undefined);
  return NextResponse.json({ ...result, notes: parsed.notes });
}
