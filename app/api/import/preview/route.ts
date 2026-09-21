import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { looksLikeLeads, parseWorkbook, type ParsedSheet } from "@/lib/parse";
import { guessSource, headerSignature, heuristicMap, llmMap, mergeMappings, emptyMapping, validateByContent, rulesAreConfident, type Mapping } from "@/lib/mapping";
import type { Step } from "@/lib/importer";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_LLM_PARALLEL = 3;

async function analyse(orgId: string, sheet: ParsedSheet, fileName: string, deadline: number, index: number) {
  const steps: Step[] = [];
  let t = Date.now();
  steps.push({
    step: "parse",
    status: "ok",
    detail: `${sheet.rows.length} rows, ${sheet.headers.length} columns${sheet.layout === "headerless" ? " (no header row found - inferring columns from content)" : sheet.layout === "vertical" ? " (leads were stacked vertically as cards - rebuilt into rows)" : ""}${sheet.title ? `. Title: "${sheet.title.slice(0, 70)}"` : ""}`,
    ms: Date.now() - t,
  });

  const base = {
    name: sheet.name, headers: sheet.headers, sample: sheet.rows.slice(0, 5), totalRows: sheet.rows.length, headerless: sheet.headerless,
  };
  if (!looksLikeLeads(sheet.rows)) {
    steps.push({ step: "detect_content", status: "skipped", detail: "No phone numbers or emails found - looks like a lookup list, not leads", ms: 0 });
    return { ...base, mapping: emptyMapping(), sourceGuess: null, origin: "none", steps, include: false };
  }

  t = Date.now();
  const signature = headerSignature(sheet.headers);
  const template = sheet.layout !== "table" ? null : await prisma.mappingTemplate.findUnique({ where: { orgId_signature: { orgId, signature } } });
  let mapping: Mapping;
  let sourceGuess = guessSource(sheet.name, sheet.title, fileName, sheet.headers);
  let origin: string;
  if (template) {
    mapping = { ...emptyMapping(), ...(JSON.parse(template.mapping) as Partial<Mapping>) };
    origin = "template";
    steps.push({ step: "recognise_layout", status: "ok", detail: `Seen this layout before - reused saved mapping, no LLM call`, ms: Date.now() - t });
  } else {
    const heur = heuristicMap(sheet.headers, sheet.rows);
    const rulesCheck = validateByContent(heur, sheet.headers, sheet.rows);
    if (rulesAreConfident(rulesCheck.mapping, rulesCheck.notes)) {
      mapping = heur;
      origin = "rules";
      steps.push({ step: "map_columns", status: "ok", detail: "Column names and data agree - rule-based mapping is confident, AI not needed", ms: Date.now() - t });
    } else {
      const llm = await llmMap(sheet.headers, sheet.rows, { deadline, startModel: index });
      mapping = llm ? mergeMappings(llm.mapping, heur) : heur;
      sourceGuess = sourceGuess ?? llm?.sourceGuess ?? null;
      origin = llm ? "llm" : "heuristic";
      steps.push({
        step: "map_columns",
        status: llm ? "ok" : "warn",
        detail: llm
          ? "Layout was unusual, so Groq mapped the columns (headers + sample rows only); gaps filled by rules"
          : Date.now() > deadline
            ? "AI time budget used up for this upload - rule-based mapping (check it in Review)"
            : "AI unavailable or rate-limited - used rule-based mapping (check it in Review)",
        ms: Date.now() - t,
      });
    }
  }
  const checked = validateByContent(mapping, sheet.headers, sheet.rows);
  mapping = checked.mapping;
  if (checked.notes.length) steps.push({ step: "validate_content", status: "warn", detail: checked.notes.join("; "), ms: 0 });
  else steps.push({ step: "validate_content", status: "ok", detail: "Mapped columns match their data", ms: 0 });
  return { ...base, mapping, sourceGuess: sourceGuess ?? template?.sourceName ?? null, origin, steps, include: !!(mapping.phone || mapping.email), signature };
}

/** Vercel Hobby allows up to 60s per request. */
export const maxDuration = 60;

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File larger than 10MB" }, { status: 413 });
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return NextResponse.json({ error: "Upload .xlsx, .xls or .csv" }, { status: 400 });

  let wb;
  try {
    wb = parseWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // All sheets share one AI time budget so a big workbook always answers inside the serverless limit.
  const deadline = Date.now() + 35000;
  // Analyse sheets with bounded parallelism to respect Groq free-tier rate limits.
  const results: Awaited<ReturnType<typeof analyse>>[] = new Array(wb.sheets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MAX_LLM_PARALLEL, wb.sheets.length) }, async () => {
      while (next < wb.sheets.length) {
        const i = next++;
        results[i] = await analyse(s.oid, wb.sheets[i], file.name, deadline, i);
      }
    }),
  );
  return NextResponse.json({ sheets: results, skipped: wb.skipped });
}
