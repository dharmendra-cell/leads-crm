import { prisma } from "./db";
import { extractPhones, normalizePhone } from "./phone";
import { parseDate } from "./dates";
import { FIELDS, type Mapping } from "./mapping";
import type { Row } from "./parse";
import { STATES } from "./geo";
import { classifyText, inferStatus } from "./feedback";
import { randomUUID } from "crypto";

export interface Step {
  step: string;
  status: "ok" | "warn" | "skipped" | "error";
  detail: string;
  ms: number;
}

export interface LeadInput {
  source: string;
  name: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  state: string | null;
  requirement: string | null;
  message: string | null;
  queryDate: Date | null;
  address: string | null;
  externalId: string | null;
  status: string;
  callAttempts: number;
  remarkPending: boolean;
  feedback: string[];
  score: number;
  raw: string;
}

const clean = (v: string | undefined, max = 2000) => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** Spreadsheet formulas in exported data ("=HYPERLINK(...)") are neutralised so re-export is safe. */
const safe = (s: string | null) => (s && /^[=+\-@]/.test(s) && !/^\+?\d[\d\s-]*$/.test(s) ? `'${s}` : s);

export function scoreLead(l: Pick<LeadInput, "phone" | "email" | "company" | "message" | "requirement" | "queryDate">, now = new Date()): number {
  let s = 0;
  if (l.phone) s += 30;
  if (l.email) s += 15;
  if (l.company) s += 10;
  if (l.requirement) s += 15;
  if (l.message && l.message.length > 30) s += 15;
  if (l.queryDate && now.getTime() - l.queryDate.getTime() < 7 * 86400_000) s += 15;
  return s;
}



/**
 * "Pune, Maharashtra, India" -> Pune / Maharashtra. Free-text street addresses without a state
 * ("Indrani Nagar, Indore") take the last part as the city. Best effort.
 */
export function splitAddress(addr: string | null): { city: string | null; state: string | null } {
  if (!addr) return { city: null, state: null };
  const parts = addr
    .split(",")
    .map((p) => p.replace(/\b\d{6}\b/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p && !/^india$/i.test(p));
  if (parts.length === 0) return { city: null, state: null };
  const last = parts[parts.length - 1];
  if (STATES.has(last.toLowerCase())) {
    const state = last;
    const city = parts.length >= 2 ? parts[parts.length - 2] : state;
    return { city, state };
  }
  // "Indore Madhya Pradesh" style: trailing state name glued to city
  const glued = [...STATES].find((st) => last.toLowerCase().endsWith(` ${st}`));
  if (glued) return { city: last.slice(0, last.length - glued.length - 1).trim() || null, state: last.slice(last.length - glued.length) };
  return { city: last, state: null };
}

/** Pure: raw rows + mapping -> normalised leads. */
export function transformRows(rows: Row[], mapping: Mapping, source: string, now = new Date()) {
  const leads: LeadInput[] = [];
  const invalid: { row: number; reason: string }[] = [];
  const seen = new Set<string>();
  let dupInFile = 0;
  let blank = 0;
  const mapped = [...FIELDS.map((f) => mapping[f]), ...mapping.feedback].filter(Boolean) as string[];

  rows.forEach((r, i) => {
    if (!mapped.some((h) => (r[h] ?? "").trim())) {
      blank++;
      return;
    }
    const get = (f: (typeof FIELDS)[number]) => (mapping[f] ? r[mapping[f] as string] : undefined);
    const [p1, p2] = extractPhones(get("phone"));
    let alt = normalizePhone(get("altPhone")) ?? p2;
    if (alt === p1) alt = null;
    const emailRaw = clean(get("email"))?.toLowerCase() ?? null;
    const email = emailRaw && /^\S+@\S+\.\S+$/.test(emailRaw) ? emailRaw : null;
    const name = clean(get("name"), 200);

    if (!p1 && !email) {
      invalid.push({ row: i + 2, reason: "no valid phone or email" });
      return;
    }
    const key = p1 ?? `e:${email}`;
    if (seen.has(key)) {
      dupInFile++;
      return;
    }
    seen.add(key);

    const address = clean(get("address"), 400);
    const fromAddr = splitAddress(address);
    const feedback = mapping.feedback.map((h) => (r[h] ?? "").trim()).filter(Boolean);
    const lead: LeadInput = {
      source,
      name: safe(name),
      phone: p1,
      altPhone: alt,
      email,
      company: safe(clean(get("company"), 200)),
      city: safe(clean(get("city"), 100) ?? fromAddr.city),
      state: safe(clean(get("state"), 100) ?? fromAddr.state),
      address: safe(address),
      requirement: safe(clean(get("requirement"), 300)),
      message: safe(clean(get("message"), 2000)),
      queryDate: parseDate(get("queryDate")),
      externalId: clean(get("externalId"), 100),
      status: "NEW",
      callAttempts: feedback.length,
      remarkPending: false,
      feedback: feedback.map((f) => f.slice(0, 1000)),
      score: 0,
      raw: JSON.stringify(r),
    };
    lead.score = scoreLead(lead, now);
    leads.push(lead);
  });
  return { leads, invalid, dupInFile, blank };
}

export async function commitImport(args: {
  orgId: string;
  fileName: string;
  source: string;
  rows: Row[];
  mapping: Mapping;
  signature: string;
  priorSteps: Step[];
}) {
  const steps: Step[] = [...args.priorSteps];
  const time = async <T>(step: string, fn: () => Promise<{ status?: Step["status"]; detail: string; value: T }>) => {
    const t = Date.now();
    const r = await fn();
    steps.push({ step, status: r.status ?? "ok", detail: r.detail, ms: Date.now() - t });
    return r.value;
  };

  const { leads, invalid, dupInFile } = await time("normalize", async () => {
    const v = transformRows(args.rows, args.mapping, args.source);
    return {
      status: v.invalid.length ? "warn" : "ok",
      detail: `${v.leads.length} valid leads; skipped ${v.blank} blank rows, ${v.invalid.length} with no usable phone/email, ${v.dupInFile} repeated inside file`,
      value: v,
    };
  });

  // Remarks are read with fast rules only. Unclear ones are flagged and can be classified later in batches
  // ("Classify remarks" button), so a sheet never waits on the LLM or its rate limits.
  await time("read_feedback", async () => {
    const withFb = leads.filter((l) => l.feedback.length);
    if (!withFb.length) return { status: "skipped" as const, detail: "No feedback/remark columns mapped", value: null };
    let byRule = 0;
    let pending = 0;
    for (const l of withFb) {
      const st = inferStatus(l.feedback);
      if (st) {
        l.status = st;
        byRule++;
      } else if (l.feedback.some((f) => classifyText(f) !== "NEW")) {
        l.remarkPending = true;
        pending++;
      }
    }
    return {
      status: pending ? ("warn" as const) : ("ok" as const),
      detail: `${withFb.length} leads had remarks -> status set by rules for ${byRule}; ${pending} unclear remarks are waiting for "Classify remarks" (their text is saved in history)`,
      value: null,
    };
  });

  const { fresh, existing } = await time("dedupe", async () => {
    const phones = leads.map((l) => l.phone).filter(Boolean) as string[];
    const emails = leads.map((l) => l.email).filter(Boolean) as string[];
    const found = await prisma.lead.findMany({
      where: { orgId: args.orgId, OR: [{ phone: { in: phones } }, { email: { in: emails } }] },
      select: { id: true, phone: true, email: true, source: true },
    });
    const byPhone = new Map(found.filter((f) => f.phone).map((f) => [f.phone!, f]));
    const byEmail = new Map(found.filter((f) => f.email).map((f) => [f.email!, f]));
    const fresh: LeadInput[] = [];
    const existing: { id: string; source: string; lead: LeadInput }[] = [];
    for (const l of leads) {
      const hit = (l.phone && byPhone.get(l.phone)) || (l.email && byEmail.get(l.email)) || null;
      if (hit) existing.push({ id: hit.id, source: hit.source, lead: l });
      else fresh.push(l);
    }
    const cross = existing.filter((e) => e.source !== args.source).length;
    return {
      value: { fresh, existing },
      detail: `${fresh.length} new, ${existing.length} already in CRM (${cross} came from a different source)`,
    };
  });

  const imp = await time("save", async () => {
    const created = await prisma.import.create({
      data: {
        orgId: args.orgId,
        fileName: args.fileName,
        source: args.source,
        totalRows: args.rows.length,
        inserted: fresh.length,
        duplicates: existing.length + dupInFile,
        invalid: invalid.length,
        steps: "[]",
      },
    });
    const withIds = fresh.map((l) => ({ ...l, id: randomUUID() }));
    for (let i = 0; i < withIds.length; i += 500) {
      await prisma.lead.createMany({
        data: withIds.slice(i, i + 500).map(({ feedback: _f, ...l }) => {
          void _f;
          return { ...l, orgId: args.orgId, importId: created.id };
        }),
        skipDuplicates: true,
      });
    }
    const history = withIds.flatMap((l) =>
      l.feedback.map((text) => ({
        leadId: l.id,
        orgId: args.orgId,
        userName: "imported",
        type: "NOTE",
        outcome: classifyText(text) && classifyText(text) !== "NEW" ? classifyText(text) : null,
        note: text,
      })),
    );
    for (let i = 0; i < history.length; i += 1000) {
      await prisma.interaction.createMany({ data: history.slice(i, i + 1000) });
    }
    if (existing.length) {
      // Re-uploading the same sheet must not pile up identical "enquired again" notes.
      const notes = existing.map((e) => ({
        leadId: e.id,
        orgId: args.orgId,
        type: "SYSTEM",
        note: `Enquired again via ${args.source}${e.lead.queryDate ? " on " + e.lead.queryDate.toISOString().slice(0, 10) : ""}${
          e.lead.requirement ? ` for "${e.lead.requirement}"` : ""
        }`,
      }));
      const already = await prisma.interaction.findMany({
        where: { orgId: args.orgId, type: "SYSTEM", leadId: { in: notes.map((n) => n.leadId) }, note: { in: notes.map((n) => n.note) } },
        select: { leadId: true, note: true },
      });
      const seen = new Set(already.map((a) => `${a.leadId}|${a.note}`));
      const fresh = notes.filter((n) => !seen.has(`${n.leadId}|${n.note}`));
      if (fresh.length) await prisma.interaction.createMany({ data: fresh });
    }
    await prisma.mappingTemplate.upsert({
      where: { orgId_signature: { orgId: args.orgId, signature: args.signature } },
      update: { mapping: JSON.stringify(args.mapping), sourceName: args.source },
      create: { orgId: args.orgId, signature: args.signature, sourceName: args.source, mapping: JSON.stringify(args.mapping) },
    });
    return { value: created, detail: `Inserted ${fresh.length} leads, logged ${existing.length} repeat enquiries` };
  });

  steps.push({ step: "embed", status: "ok", detail: "Semantic index building in background (pgvector)", ms: 0 });
  await prisma.import.update({ where: { id: imp.id }, data: { steps: JSON.stringify(steps) } });

  return {
    importId: imp.id,
    totalRows: args.rows.length,
    inserted: fresh.length,
    duplicates: existing.length + dupInFile,
    invalid: invalid.length,
    invalidSample: invalid.slice(0, 10),
    steps,
  };
}
