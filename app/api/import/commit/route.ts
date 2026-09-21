import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, unauthorized } from "@/lib/auth";
import { parseWorkbook } from "@/lib/parse";
import { commitImport } from "@/lib/importer";
import { FIELDS, headerSignature, emptyMapping, type Mapping } from "@/lib/mapping";
import { embedPendingLeads } from "@/lib/embeddings";

const StepSchema = z.object({ step: z.string(), status: z.enum(["ok", "warn", "skipped", "error"]), detail: z.string(), ms: z.number() });
const Plan = z.array(
  z.object({
    name: z.string(),
    source: z.string().trim().min(1).max(60),
    mapping: z.object({
      ...Object.fromEntries(FIELDS.map((f) => [f, z.string().nullable().optional()])),
      feedback: z.array(z.string()).default([]),
    }),
    steps: z.array(StepSchema).default([]),
  }),
);

/** Vercel Hobby allows up to 60s per request. */
export const maxDuration = 60;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  let plan;
  try {
    plan = Plan.parse(JSON.parse(String(form.get("plan"))));
  } catch {
    return NextResponse.json({ error: "Invalid import plan" }, { status: 400 });
  }
  if (!plan.length) return NextResponse.json({ error: "Select at least one sheet" }, { status: 400 });

  const wb = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  const results: Array<{ sheet: string; source: string } & Awaited<ReturnType<typeof commitImport>>> = [];
  // Sheets are committed sequentially so later sheets dedupe against earlier ones.
  for (const item of plan) {
    const sheet = wb.sheets.find((x) => x.name === item.name);
    if (!sheet) continue;
    const mapping = { ...emptyMapping(), ...item.mapping } as Mapping;
    if (!mapping.phone && !mapping.email) continue;
    const bad = [...FIELDS.map((f) => mapping[f]), ...mapping.feedback].filter((h) => h && !sheet.headers.includes(h));
    if (bad.length) return NextResponse.json({ error: `Sheet "${item.name}": unknown columns ${bad.join(", ")}` }, { status: 400 });
    const r = await commitImport({
      orgId: s.oid, fileName: `${file.name} > ${sheet.name}`.slice(0, 200), source: item.source,
      rows: sheet.rows, mapping, signature: headerSignature(sheet.headers), priorSteps: item.steps,
    });
    results.push({ sheet: sheet.name, source: item.source, ...r });
  }
  void embedPendingLeads(s.oid).catch((e) => console.error("embed failed", e));
  const sum = (k: "inserted" | "duplicates" | "invalid") => results.reduce((a, r) => a + r[k], 0);
  return NextResponse.json({ sheets: results, totals: { inserted: sum("inserted"), duplicates: sum("duplicates"), invalid: sum("invalid") } });
}
