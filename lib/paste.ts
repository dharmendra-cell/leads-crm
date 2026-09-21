import { extractPhones } from "./phone";
import { parseDate } from "./dates";
import { STATES } from "./geo";
import { emptyMapping, heuristicMap, llmMap, mergeMappings, validateByContent, type Mapping } from "./mapping";
import type { Row } from "./parse";

/**
 * Pasted leads: rows copied from Excel / a website / a chat, usually tab-separated, in any column order and
 * without headers, e.g.  "2026-09-21  07771975883  Imran Gori  Bumtum Diaper B Grade-4000 Pack  Indore, Madhya Pradesh, India  Aayesha Collection  x@y.com".
 * Each column's role is read from what its cells look like; only unclear text columns fall back to position rules or the LLM.
 */
export type CellKind = "empty" | "email" | "phone" | "date" | "address" | "requirement" | "text";

const QTY = /\d[\d,]*\s*(?:pcs|pc|pieces?|packs?|pkts?|packets?|boxes|box|cartons?|ctns?|rolls?|units?|nos|sets?|kgs?|litres?|liters?|ltr|bottles?|dozens?|pairs?)\b/i;
const DATE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|^\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?\s+\d{2,4}/;

export function cellKind(raw: string): CellKind {
  const v = raw.replace(/[​-‏﻿]/g, "").trim();
  if (!v) return "empty";
  if (/^\S+@\S+\.\S+$/.test(v)) return "email";
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15 && /^[\s+\-()\d/,.]+$/.test(v) && !DATE.test(v)) return "phone";
  if (DATE.test(v) && parseDate(v)) return "date";
  const parts = v.split(",").map((p) => p.trim());
  if (parts.length >= 2 && (/india/i.test(v) || parts.length >= 3 || STATES.has(parts[parts.length - 1].toLowerCase()))) return "address";
  if (QTY.test(v)) return "requirement";
  return "text";
}

/** Split pasted text into rows of cells. Tabs first (Excel/web tables), then "|" or runs of 3+ spaces. */
export function splitPasted(text: string): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  return lines.map((l) => {
    if (l.includes("\t")) return l.split("\t").map((c) => c.trim());
    if (l.includes("|")) return l.split("|").map((c) => c.trim());
    if (/\s{3,}/.test(l)) return l.split(/\s{3,}/).map((c) => c.trim());
    return [l.trim()];
  });
}

const looksLikeHeader = (cells: string[]) => {
  const filled = cells.filter(Boolean);
  return filled.length >= 3 && filled.every((c) => cellKind(c) === "text" && c.length <= 40 && !/\d{4,}/.test(c));
};

export interface ParsedPaste {
  headers: string[];
  rows: Row[];
  mapping: Mapping;
  notes: string[];
  hadHeader: boolean;
}

/** One free-text line (no tabs): pull out phone, email and date, keep the rest as name/details. */
function fromSingleCell(line: string): string[] {
  const email = line.match(/\S+@\S+\.\S+/)?.[0] ?? "";
  const phone = line.match(/(?:\+?\d[\d\s\-()]{8,}\d)/)?.[0] ?? "";
  const rest = line.replace(email, " ").replace(phone, " ").replace(/\s+/g, " ").trim();
  return [rest, phone.trim(), email];
}

export async function parsePasted(text: string, opts: { useLlm?: boolean } = {}): Promise<ParsedPaste> {
  const notes: string[] = [];
  let grid = splitPasted(text);
  if (grid.length && grid.every((r) => r.length === 1)) {
    grid = grid.map((r) => fromSingleCell(r[0]));
    notes.push("No tabs or columns found - read each line as free text (name, phone, email). Paste from Excel for best results.");
  }
  const width = Math.max(0, ...grid.map((r) => r.length));
  if (!grid.length || !width) return { headers: [], rows: [], mapping: emptyMapping(), notes: ["Nothing to read."], hadHeader: false };

  // A pasted header row (2+ lines, first line all labels): reuse the normal sheet mapping.
  const hadHeader = grid.length >= 2 && looksLikeHeader(grid[0]);
  if (hadHeader) {
    const headers = grid[0].map((h, i) => h || `Column ${i + 1}`);
    const rows = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])) as Row);
    const { mapping, notes: n } = validateByContent(heuristicMap(headers, rows), headers, rows);
    return { headers, rows, mapping, notes: [...notes, ...n], hadHeader };
  }

  const headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const rows = grid.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])) as Row);

  // Role of each column = what most of its cells look like.
  const roles = headers.map((h) => {
    const counts = new Map<CellKind, number>();
    for (const r of rows) counts.set(cellKind(r[h]), (counts.get(cellKind(r[h])) ?? 0) + 1);
    counts.delete("empty");
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "empty";
  });

  const m = emptyMapping();
  const idx = (k: CellKind) => roles.map((r, i) => (r === k ? i : -1)).filter((i) => i >= 0);
  const [p1, p2] = idx("phone");
  if (p1 !== undefined) m.phone = headers[p1];
  if (p2 !== undefined) m.altPhone = headers[p2];
  m.email = idx("email")[0] !== undefined ? headers[idx("email")[0]] : null;
  m.queryDate = idx("date")[0] !== undefined ? headers[idx("date")[0]] : null;
  m.address = idx("address")[0] !== undefined ? headers[idx("address")[0]] : null;
  m.requirement = idx("requirement")[0] !== undefined ? headers[idx("requirement")[0]] : null;

  // Plain text columns: before the product column = name (then company); after it = company, then remarks.
  const reqAt = m.requirement ? headers.indexOf(m.requirement) : -1;
  const texts = idx("text");
  const before = reqAt >= 0 ? texts.filter((i) => i < reqAt) : texts;
  const after = reqAt >= 0 ? texts.filter((i) => i > reqAt) : [];
  const take = (arr: number[]) => arr.shift();
  const b = [...before];
  const a = [...after];
  let i = take(b);
  if (i !== undefined) m.name = headers[i];
  i = take(b);
  if (i !== undefined) m.company = headers[i];
  i = take(a);
  if (i !== undefined) {
    if (m.company) m.feedback.push(headers[i]);
    else m.company = headers[i];
  }
  for (const rest of [...b, ...a]) m.feedback.push(headers[rest]);
  if (reqAt < 0 && m.name && m.company && texts.length >= 3) {
    // No quantity in the product text: guess name, company, product in that order.
    m.requirement = headers[texts[2]];
    m.feedback = m.feedback.filter((h) => h !== m.requirement);
    notes.push("Could not spot the product by quantity; assumed the third text column is the product.");
  }

  // Unclear layout (e.g. no product found): let the LLM read the columns from content.
  const unclear = !m.name || !m.requirement;
  if (unclear && opts.useLlm !== false) {
    const llm = await llmMap(headers, rows, { deadline: Date.now() + 15000 });
    if (llm) {
      const merged = mergeMappings(llm.mapping, m);
      Object.assign(m, merged);
      notes.push("Some columns were unclear, so AI helped read them.");
    }
  }
  return { headers, rows, mapping: m, notes, hadHeader };
}
