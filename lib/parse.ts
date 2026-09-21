import * as XLSX from "xlsx";

export type Row = Record<string, string>;
export interface ParsedSheet {
  name: string;
  /** Text found above the header (report titles like "Trade India June 2026 Buyleads Data"), used to guess the source. */
  title: string;
  headers: string[];
  rows: Row[];
  headerless: boolean;
  /** table = normal rows; headerless = no header row; vertical = one lead spread over several lines (copy-pasted cards). */
  layout: "table" | "headerless" | "vertical";
}
export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  skipped: { name: string; reason: string }[];
}

const MAX_ROWS = 20000;
const PHONE_LIKE = /^\+?[\d\s\-()​]{8,18}$/;

const p2 = (n: number) => String(n).padStart(2, "0");
/** Excel date cells arrive a few seconds off midnight; round to the minute and keep local wall-clock time. */
function localStamp(v: Date): string {
  const d = new Date(Math.round(v.getTime() / 60000) * 60000);
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return d.getHours() || d.getMinutes() ? `${day} ${p2(d.getHours())}:${p2(d.getMinutes())}:00` : day;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : localStamp(v);
  return String(v).replace(/[​-‏﻿]/g, "").trim();
}

/** Values that look like data (phones, emails, dates, plain numbers) - a real header row has none of these. */
const dataLike = (s: string) => PHONE_LIKE.test(s) || s.includes("@") || /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d+(\.\d+)?$/.test(s);

/** Does this sheet contain contact-like data at all? Filters out lookup lists and blank tabs. */
export function looksLikeLeads(rows: Row[]): boolean {
  let hits = 0;
  for (const r of rows.slice(0, 60)) {
    for (const v of Object.values(r)) {
      if (v.includes("@") || PHONE_LIKE.test(v)) {
        hits++;
        break;
      }
    }
  }
  return hits >= 2;
}

const VERTICAL_HEADERS = ["Name", "Phone", "Company", "City", "Requirement", "Date"];
const LONG_DATE = /\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;

/**
 * Some exports are copy-pasted "cards": each lead is a stack of lines (name, phone, company, city, product, date),
 * with several cards side by side. A card starts at a phone-like line whose previous line is not a phone.
 */
function verticalBlocks(cells: string[][]): Row[] {
  const rows: Row[] = [];
  const width = Math.max(...cells.map((r) => r.length));
  for (let c = 0; c < width; c++) {
    const col = cells.map((r) => r[c] ?? "").filter(Boolean);
    const starts: number[] = [];
    col.forEach((v, i) => {
      if (i > 0 && PHONE_LIKE.test(v) && v.replace(/\D/g, "").length >= 10 && !PHONE_LIKE.test(col[i - 1])) starts.push(i);
    });
    starts.forEach((pi, k) => {
      const stop = k + 1 < starts.length ? starts[k + 1] - 1 : col.length;
      const rest = col.slice(pi + 1, stop).filter((v) => !/^add labels$/i.test(v));
      const di = rest.findIndex((v) => LONG_DATE.test(v));
      const date = di >= 0 ? rest.splice(di, 1)[0] : "";
      rows.push({ Name: col[pi - 1], Phone: col[pi], Company: rest[0] ?? "", City: rest[1] ?? "", Requirement: rest.slice(2).join(" "), Date: date });
    });
  }
  return rows;
}

function parseSheet(name: string, matrix: unknown[][]): ParsedSheet | { skip: string } {
  const cells = matrix.map((r) => r.map(cellToString));
  const nonEmpty = (r: string[]) => r.filter(Boolean).length;
  if (cells.length < 2) return { skip: "empty or a single row" };

  // Header row = first row (in the first 15) that is mostly labels (not phones/emails/dates) and nearly as wide as the widest such row.
  const candidates: { i: number; n: number }[] = [];
  for (let i = 0; i < Math.min(15, cells.length); i++) {
    const filled = cells[i].filter(Boolean);
    if (filled.length < 3) continue;
    if (filled.filter((c) => !dataLike(c)).length / filled.length >= 0.8) candidates.push({ i, n: filled.length });
  }
  const widest = Math.max(0, ...candidates.map((c) => c.n));
  const headerIdx = candidates.find((c) => c.n >= widest * 0.5)?.i ?? -1;

  const width = Math.max(...cells.slice(0, 200).map((r) => r.length));
  const headerless = headerIdx < 0;
  if (headerless && width <= 8) {
    const blocks = verticalBlocks(cells);
    if (blocks.length >= 5) return { name, title: "", headers: VERTICAL_HEADERS, rows: blocks, headerless: false, layout: "vertical" };
  }
  const seen = new Map<string, number>();
  const headers = headerless
    ? Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
    : cells[headerIdx].map((h, i) => {
        let n = h || `Column ${i + 1}`;
        const c = seen.get(n) ?? 0;
        seen.set(n, c + 1);
        if (c > 0) n = `${n} (${c + 1})`;
        return n;
      });

  const title = headerless
    ? ""
    : cells.slice(0, headerIdx).flat().filter(Boolean).join(" ").slice(0, 200);

  const rows: Row[] = [];
  for (const r of cells.slice(headerless ? 0 : headerIdx + 1, (headerless ? 0 : headerIdx + 1) + MAX_ROWS)) {
    if (!nonEmpty(r)) continue;
    const row: Row = {};
    headers.forEach((h, i) => (row[h] = r[i] ?? ""));
    rows.push(row);
  }
  if (!rows.length) return { skip: "no data rows" };
  return { name, title, headers, rows, headerless, layout: headerless ? "headerless" : "table" };
}

/** Parse every sheet of an xlsx/xls/csv. Each sheet is analysed independently (own header row, title, layout). */
export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets: ParsedSheet[] = [];
  const skipped: ParsedWorkbook["skipped"] = [];
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", blankrows: false });
    const res = parseSheet(name.trim(), matrix);
    if ("skip" in res) skipped.push({ name: name.trim(), reason: res.skip });
    else sheets.push(res);
  }
  if (!sheets.length) throw new Error("No sheet with data rows was found in this file");
  return { sheets, skipped };
}
