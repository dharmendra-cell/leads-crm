import { createHash } from "crypto";
import { z } from "zod";
import { groq, MODEL } from "./groq";
import type { Row } from "./parse";
import { STATES } from "./geo";

export const FIELDS = [
  "name", "phone", "altPhone", "email", "company", "city", "state", "address",
  "requirement", "message", "queryDate", "externalId",
] as const;
export type Field = (typeof FIELDS)[number];
/** Single-column fields plus `feedback`: any number of caller-remark columns, read in order. */
export type Mapping = Record<Field, string | null> & { feedback: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Aliases in PRIORITY order (first alias that matches any header wins). Covers IndiaMART, TradeIndia,
// ExportersIndia, JustDial, Google Maps scrapes and hand-made call sheets (incl. typos like "Feetback").
const ALIASES: Record<Field, string[]> = {
  name: ["sendername", "name", "contactperson", "contactname", "buyername", "customername", "fullname", "person", "leadname"],
  phone: ["sendermobile", "contactno", "mobile", "mobileno", "mobilenumber", "phone", "phoneno", "phonenumber", "number", "contactnumber", "whatsapp", "cell", "buyermobile", "telephone"],
  altPhone: ["senderphone", "altmobile", "alternatemobile", "alternatephone", "altphone", "mobile2", "phone2", "secondarymobile", "landline"],
  email: ["senderemail", "email", "emails", "emailid", "emailaddress", "mail", "buyeremail"],
  company: ["sendercompany", "companyname", "company", "business", "businessname", "organization", "organisation", "firm"],
  city: ["sendercity", "city", "town"],
  state: ["senderstate", "state", "province"],
  address: ["senderaddress", "address", "citystate", "fulladdress", "location", "region"],
  requirement: ["queryproductname", "productdetails", "product", "productname", "requirement", "productrequired", "enquiryfor", "inquiryfor", "inquiry", "enquiry", "category", "subject", "item", "productinterest", "querysubject"],
  message: ["querymessage", "enquirymessage", "inquirymessage", "description", "details", "requirementdetails", "enquirydetails"],
  queryDate: ["querytime", "querydate", "enquirydate", "inquirydate", "dateofenquiry", "receivedon", "createdon", "leaddate", "date", "datere", "posteddate", "time"],
  externalId: ["queryid", "leadid", "enquiryid", "inquiryid", "refno", "referenceno", "uniquequeryid"],
};

const FEEDBACK_RE = /feedback|feetback|feadback|remark|comment|callstatus|callresponse|outcome|response|followup|status$/;

export const emptyMapping = (): Mapping => ({
  ...(Object.fromEntries(FIELDS.map((f) => [f, null])) as Record<Field, string | null>),
  feedback: [],
});

export function headerSignature(headers: string[]): string {
  return createHash("sha1").update(headers.map(norm).sort().join("|")).digest("hex");
}

/** Deterministic mapper. Fallback when there is no LLM and gap-filler when the LLM misses a column. */
export function heuristicMap(headers: string[], rows: Row[]): Mapping {
  const mapping = emptyMapping();
  const used = new Set<string>();
  const nh = headers.map((h) => ({ h, n: norm(h) }));

  mapping.feedback = nh.filter((x) => FEEDBACK_RE.test(x.n)).map((x) => x.h);
  mapping.feedback.forEach((h) => used.add(h));

  for (const field of FIELDS) {
    for (const alias of ALIASES[field]) {
      const hit = nh.find((x) => !used.has(x.h) && x.n === alias);
      if (hit) {
        mapping[field] = hit.h;
        used.add(hit.h);
        break;
      }
    }
  }

  // Content-based fallback for phone: a column whose sample values mostly look like phone numbers.
  if (!mapping.phone) {
    const sample = rows.slice(0, 30);
    let bestH: string | null = null;
    let bestScore = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const score = sample.filter((r) => /^\+?[\d\s\-()​]{10,16}$/.test(r[h] ?? "")).length;
      if (score > bestScore) {
        bestScore = score;
        bestH = h;
      }
    }
    if (bestH && bestScore >= Math.max(2, sample.length / 3)) mapping.phone = bestH;
  }
  // Headerless sheets ("Column 3"): infer email and date columns from content.
  const sample = rows.slice(0, 30);
  const shareRe = (h: string, re: RegExp) => sample.filter((r) => re.test(r[h] ?? "")).length / Math.max(1, sample.length);
  if (!mapping.email) {
    const h = headers.find((x) => !used.has(x) && shareRe(x, /@/) >= 0.3);
    if (h) {
      mapping.email = h;
      used.add(h);
    }
  }
  if (!mapping.queryDate) {
    const h = headers.find((x) => !used.has(x) && shareRe(x, /^\d{4}-\d{2}-\d{2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/) >= 0.5);
    if (h) {
      mapping.queryDate = h;
      used.add(h);
    }
  }
  return mapping;
}

const CONTENT_TESTS: Partial<Record<Field, (v: string) => boolean>> = {
  phone: (v) => v.replace(/[^\d]/g, "").length >= 10 && /^[+\d][\d\s\-()+/,.\u200B]*$/.test(v),
  email: (v) => /\S+@\S+\.\S+/.test(v),
  state: (v) => STATES.has(v.toLowerCase().trim()),
  queryDate: (v) => /^\d{4}-\d{2}-\d{2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|^\d{1,2}[ -][A-Za-z]{3}/.test(v),
};

const share = (rows: Row[], h: string, test: (v: string) => boolean) => {
  const vals = rows.slice(0, 60).map((r) => r[h] ?? "").filter(Boolean);
  return vals.length ? vals.filter(test).length / vals.length : 0;
};

/**
 * Header labels in real sheets often do not line up with the data (shifted columns, wrong titles).
 * If the mapped phone/email/date column does not contain that kind of value, re-pick by content.
 * Returns the fixed mapping and human-readable notes for anything that was changed or still looks wrong.
 */
export function validateByContent(mapping: Mapping, headers: string[], rows: Row[]): { mapping: Mapping; notes: string[] } {
  const out: Mapping = { ...mapping, feedback: [...mapping.feedback] };
  const notes: string[] = [];
  for (const field of Object.keys(CONTENT_TESTS) as Field[]) {
    const test = CONTENT_TESTS[field]!;
    const cur = out[field];
    if (cur && share(rows, cur, test) >= 0.3) continue;
    let best: string | null = null;
    let bestShare = 0.5;
    for (const h of headers) {
      if (h === cur) continue;
      const sh = share(rows, h, test);
      if (sh > bestShare) [best, bestShare] = [h, sh];
    }
    if (best) {
      const displaced = cur;
      const hadCity = out.city;
      for (const f of FIELDS) if (out[f] === best) out[f] = null;
      out.feedback = out.feedback.filter((h) => h !== best);
      out[field] = best;
      // Shifted location columns: the old "state" column actually holds cities.
      if (field === "state" && displaced && !out.city && !hadCity?.length) out.city = displaced;
      notes.push(`"${field}" column was re-detected as "${best}" because "${cur ?? "(none)"}" did not contain ${field}-like values`);
    } else if (cur) {
      notes.push(`Mapped ${field} column "${cur}" does not look like ${field} values - check the sample rows`);
    }
  }
  // Unlabelled trailing columns ("Column 10") that hold free text are almost always caller remarks.
  const mappedAll = new Set<string>([...FIELDS.map((f) => out[f]).filter(Boolean), ...out.feedback] as string[]);
  for (const h of headers) {
    if (!/^Column \d+$/.test(h) || mappedAll.has(h)) continue;
    const vals = rows.slice(0, 60).map((r) => r[h] ?? "").filter(Boolean);
    const texty = vals.filter((v) => /[A-Za-z]{3}/.test(v) && !/@/.test(v)).length;
    if (vals.length >= 3 && texty / vals.length >= 0.7) {
      out.feedback.push(h);
      notes.push(`Unlabelled column "${h}" looks like caller remarks - treated as feedback`);
    }
  }
  return { mapping: out, notes };
}

const LlmSchema = z.object({
  source_guess: z.string().nullish(),
  mapping: z.record(z.string(), z.string().nullish()),
  feedback_columns: z.array(z.string()).nullish(),
});

/** Ask Groq to map arbitrary headers to our schema. Only headers + 5 sample rows are sent. */
export async function llmMap(
  headers: string[],
  rows: Row[],
): Promise<{ mapping: Mapping; sourceGuess: string | null } | null> {
  const client = groq();
  if (!client) return null;
  const sample = rows.filter((r) => Object.values(r).filter(Boolean).length > 3).slice(0, 5);
  const prompt = `You map columns of a messy B2B lead sheet (IndiaMART, TradeIndia, ExportersIndia, JustDial, Google Maps scrapes, hand-made call sheets) to a fixed schema.

Schema fields: ${FIELDS.join(", ")}
- name: person; company: business name; phone: primary phone (mobile or landline); altPhone: secondary number
- city/state: only if separate columns exist; address: full or "City, State" style address column
- requirement: product/service enquired about (or business category); message: free-text enquiry body
- queryDate: when the enquiry arrived; externalId: platform's own lead id (NOT a serial number like S.No)
- feedback_columns: ALL columns holding caller remarks/feedback/call outcomes (may be several, e.g. "First Feetback", "Remarks"), in reading order

Headers: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sample)}

Return JSON: {"source_guess": "IndiaMART|TradeIndia|ExportersIndia|JustDial|Google Maps|Direct|Unknown", "mapping": {"<field>": "<exact header or null>"}, "feedback_columns": ["<exact header>"]}.
Use each header once, only headers from the list, null when nothing fits. Ignore serial-number and empty "Column N" headers.`;
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = LlmSchema.parse(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    const valid = new Set(headers);
    const mapping = emptyMapping();
    const used = new Set<string>();
    for (const h of parsed.feedback_columns ?? []) {
      if (valid.has(h) && !used.has(h)) {
        mapping.feedback.push(h);
        used.add(h);
      }
    }
    for (const f of FIELDS) {
      const h = parsed.mapping[f];
      if (h && valid.has(h) && !used.has(h)) {
        mapping[f] = h;
        used.add(h);
      }
    }
    const sg = parsed.source_guess;
    return { mapping, sourceGuess: sg && sg !== "Unknown" ? sg : null };
  } catch (e) {
    console.error("llmMap failed, falling back to heuristics:", e);
    return null;
  }
}

/** primary wins; fallback fills only columns primary left unmapped. */
export function mergeMappings(primary: Mapping, fallback: Mapping): Mapping {
  const out = emptyMapping();
  const used = new Set<string>();
  out.feedback = [...new Set([...primary.feedback, ...fallback.feedback])];
  out.feedback.forEach((h) => used.add(h));
  for (const src of [primary, fallback]) {
    for (const f of FIELDS) {
      const h = src[f];
      if (!out[f] && h && !used.has(h)) {
        out[f] = h;
        used.add(h);
      }
    }
  }
  return out;
}

/** Guess the platform from any text: sheet name, report title above the header, or file name. */
export function guessSourceFromText(text: string): string | null {
  const f = text.toLowerCase().replace(/[^a-z]/g, "");
  if (f.includes("indiamart") || f.includes("indiamart")) return f.includes("direct") ? "IndiaMART Direct" : "IndiaMART";
  if (f.includes("tradeindia")) return "TradeIndia";
  if (f.includes("exportersindia")) return "ExportersIndia";
  if (f.includes("justdial")) return "JustDial";
  if (f.includes("tradeleads")) return "TradeIndia";
  if (f.includes("googlemap")) return "Google Maps";
  return null;
}

/** Sheet name and title win over the file name (one workbook often holds several platforms). */
export function guessSource(sheetName: string, title: string, fileName: string, headers: string[]): string | null {
  const hs = headers.map(norm);
  return (
    guessSourceFromText(`${sheetName} ${title}`) ??
    guessSourceFromText(fileName) ??
    (hs.includes("queryid") && hs.some((h) => h.startsWith("sender")) ? "IndiaMART" : null)
  );
}
