import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizePhone, extractPhones } from "../lib/phone";
import { parseDate } from "../lib/dates";
import { classifyText, inferStatus } from "../lib/feedback";
import { parseWorkbook, looksLikeLeads } from "../lib/parse";
import { heuristicMap, validateByContent, guessSource } from "../lib/mapping";
import { transformRows, splitAddress } from "../lib/importer";
import { applyWorkflow } from "../lib/workflow";
import { buildWhere, dateRange } from "../lib/filters";
import { groupOfSource } from "../lib/constants";

const book = (sheets: Record<string, unknown[][]>) => {
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

describe("phone", () => {
  it("handles zero-width chars, leading 0, +91, landline STD", () => {
    expect(normalizePhone("​07942960896")).toBe("+917942960896");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("919572497977")).toBe("+919572497977");
    expect(normalizePhone("4068106585")).toBe("+914068106585");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("splits multiple numbers in a cell", () => {
    expect(extractPhones("98765 43210 / 98111 22233")).toEqual(["+919876543210", "+919811122233"]);
  });
});

describe("dates", () => {
  it("parses Indian and long formats", () => {
    expect(parseDate("16th June 2026 | 09:36 AM")?.getMonth()).toBe(5);
    expect(parseDate("12/09/2025")?.getMonth()).toBe(8);
    expect(parseDate("2026-09-02")?.getDate()).toBe(2);
    expect(parseDate("garbage")).toBeNull();
    expect(parseDate("31-05-46141")).toBeNull();
    expect(parseDate("45000")).toBeNull();
  });
});

describe("feedback -> status", () => {
  it.each([
    ["Not Answering", "NOT_PICKED"],
    ["koi Req nai hain", "NOT_INTERESTED"],
    ["sorry i have found lower rate than your, already purchased", "LOST"],
    ["Only The lead was Purchesed  No conversation Took Place", "NEW"],
    ["invaild number", "NOT_PICKED"],
    ["Quotation Share", "INTERESTED"],
  ])("%s -> %s", (t, s) => expect(classifyText(t)).toBe(s));
  it("latest meaningful remark wins", () => {
    expect(inferStatus(["Not Answering", "", "koi Req nai hain"])).toBe("NOT_INTERESTED");
  });
});

describe("messy workbooks", () => {
  const buf = book({
    // title rows above header, blank S.No-only rows, feedback typo columns
    Sheet1: [
      ["Company report 3rd April IndiaMart Direct Inquiry Data"],
      [],
      ["S.No", "Date", "Number", "Name", "Inquiry", "City /State", "Email", "First Feetback", "Second Feetback"],
      [1, "2026-09-02", "​09840701047", "Satish", "Baby Wipes", "Indore, Madhya Pradesh, India", "a@b.com", "Not Answering", "koi Req nai hain"],
      [2, "", "", "", "", "", "", "", ""],
      [3, "2026-09-03", "9876543210", "Awash", "Napkins", "Pune, Maharashtra, India", "", "", ""],
    ],
    "Product Details": [["S.No", "Wipe types"], [1, "Baby"], [2, "Face"]],
    // header labels shifted relative to data (real TradeIndia sheet)
    Shifted: [
      ["S.No", "Name", "Company Name", "Requirement", "EmailID", "Contact No", "City", "State", "Remarks", "Column 10"],
      ...Array.from({ length: 6 }, (_, i) => [i + 1, "N" + i, "Co", "Looking for wipes", "2026-09-17", "", "9190000000" + (10 + i), "Jodhpur", "Rajasthan", "Koi Req nai hain"]),
    ],
    // no header, one lead per 6-line card, two cards side by side
    Cards: [
      ["anwar", "", "Maimoon"], ["919250333154", "", "919607636126"], ["New Company", "", "Co 2"], ["Add Labels", "", "Add Labels"],
      ["Delhi", "", "Pune"], ["tissue paper", "", "napkins"], ["16th June 2026 | 09:36 AM", "", "17th June 2026 | 10:00 AM"],
      ["ravi", "", "sita"], ["919111111111", "", "919222222222"], ["Co 3", "", "Co 4"], ["Add Labels", "", "Add Labels"],
      ["Goa", "", "Agra"], ["wipes", "", "soap"], ["18th June 2026 | 09:36 AM", "", "19th June 2026 | 10:00 AM"],
      ["mohan", "", "geeta"], ["919333333333", "", "919444444444"], ["Co 5", "", "Co 6"], ["Add Labels", "", "Add Labels"],
      ["Jaipur", "", "Surat"], ["paper", "", "cups"], ["20th June 2026 | 09:36 AM", "", "21st June 2026 | 10:00 AM"],
    ],
    Empty: [[]],
  });
  const wb = parseWorkbook(buf);
  const by = (n: string) => wb.sheets.find((s) => s.name === n)!;

  it("finds header below title rows and skips empty sheets", () => {
    expect(by("Sheet1").headers[2]).toBe("Number");
    expect(by("Sheet1").title).toContain("IndiaMart Direct");
    expect(wb.skipped.map((s) => s.name)).toContain("Empty");
  });
  it("flags lookup sheets as not leads", () => {
    expect(looksLikeLeads(by("Product Details").rows)).toBe(false);
    expect(looksLikeLeads(by("Sheet1").rows)).toBe(true);
  });
  it("maps, splits address, builds history, ignores blank rows", () => {
    const sh = by("Sheet1");
    const m = heuristicMap(sh.headers, sh.rows);
    expect(m.feedback).toEqual(["First Feetback", "Second Feetback"]);
    const t = transformRows(sh.rows, m, "IndiaMART Direct");
    expect(t.leads).toHaveLength(2);
    expect(t.blank).toBe(1);
    expect(t.leads[0]).toMatchObject({ phone: "+919840701047", city: "Indore", state: "Madhya Pradesh", email: "a@b.com" });
    expect(t.leads[0].feedback).toEqual(["Not Answering", "koi Req nai hain"]);
    expect(guessSource(sh.name, sh.title, "x.xlsx", sh.headers)).toBe("IndiaMART Direct");
  });
  it("re-detects columns when headers do not match the data", () => {
    const sh = by("Shifted");
    const { mapping, notes } = validateByContent(heuristicMap(sh.headers, sh.rows), sh.headers, sh.rows);
    expect(mapping.phone).toBe("City");
    expect(notes.length).toBeGreaterThan(0);
    expect(mapping.state).toBe("Remarks");
    expect(mapping.city).toBe("State");
    expect(mapping.feedback).toContain("Column 10");
    const t = transformRows(sh.rows, mapping, "TradeIndia");
    expect(t.leads).toHaveLength(6);
    expect(t.leads[0]).toMatchObject({ city: "Jodhpur", state: "Rajasthan" });
    expect(t.leads[0].feedback).toEqual(["Koi Req nai hain"]);
  });
  it("rebuilds stacked card layouts into rows", () => {
    const sh = by("Cards");
    expect(sh.layout).toBe("vertical");
    expect(sh.rows).toHaveLength(6);
    const t = transformRows(sh.rows, heuristicMap(sh.headers, sh.rows), "TradeIndia");
    expect(t.leads[0]).toMatchObject({ name: "anwar", phone: "+919250333154", city: "Delhi", requirement: "tissue paper" });
    expect(t.leads[0].queryDate?.getFullYear()).toBe(2026);
  });
});

describe("misc", () => {
  it("splits addresses", () => {
    expect(splitAddress("Pune, Maharashtra, India")).toEqual({ city: "Pune", state: "Maharashtra" });
    expect(splitAddress("Indore")).toEqual({ city: "Indore", state: null });
    expect(splitAddress("Dewas Naka, Indrani Nagar, Indore")).toEqual({ city: "Indore", state: null });
    expect(splitAddress("Indore, Madhya Pradesh 452010")).toEqual({ city: "Indore", state: "Madhya Pradesh" });
  });
  it("neutralises formula injection", () => {
    const t = transformRows([{ P: "9876543210", N: "=HYPERLINK(\"x\")" }], { ...heuristicMap(["P", "N"], []), phone: "P", name: "N" }, "X");
    expect(t.leads[0].name?.startsWith("'")).toBe(true);
  });
});

describe("workflow", () => {
  const now = new Date("2026-09-21T08:00:00");
  it("schedules retry after not picked and suggests closing after 4 attempts", () => {
    const a = applyWorkflow("NOT_PICKED", { callAttempts: 0, nextFollowUp: null }, null, now);
    expect(a.nextFollowUp?.getDate()).toBe(22);
    expect(applyWorkflow("NOT_PICKED", { callAttempts: 3, nextFollowUp: null }, null, now).suggestion).toBeTruthy();
  });
  it("clears follow-up when closed and respects explicit dates", () => {
    expect(applyWorkflow("LOST", { callAttempts: 1, nextFollowUp: now }, null, now).nextFollowUp).toBeNull();
    const d = new Date("2026-10-01");
    expect(applyWorkflow("INTERESTED", { callAttempts: 0, nextFollowUp: null }, d, now).nextFollowUp).toEqual(d);
  });
});

describe("source filter groups", () => {
  it("Direct covers IndiaMART Direct + Direct; Other excludes all named platforms", () => {
    expect(buildWhere("o", { source: "Direct" }).source).toEqual({ in: ["IndiaMART Direct", "Direct"] });
    expect(buildWhere("o", { source: "Other" }).source).toEqual({ notIn: ["IndiaMART", "TradeIndia", "JustDial", "IndiaMART Direct", "Direct"] });
    expect(buildWhere("o", { source: "Google Maps" }).source).toBe("Google Maps");
    expect(groupOfSource("Google Maps")).toBe("Other");
    expect(groupOfSource("IndiaMART Direct")).toBe("Direct");
  });
});

describe("date filters (IST)", () => {
  it("month covers the whole IST month", () => {
    const r = dateRange({ month: "2026-09" })!;
    expect(r.gte?.toISOString()).toBe("2026-09-01T00:00:00.000+05:30".replace("+05:30", "Z") && new Date("2026-09-01T00:00:00+05:30").toISOString());
    expect(r.lt?.toISOString()).toBe(new Date("2026-10-01T00:00:00+05:30").toISOString());
  });
  it("December rolls to next year; from/to are inclusive and intersect with day", () => {
    expect(dateRange({ month: "2026-12" })!.lt?.toISOString()).toBe(new Date("2027-01-01T00:00:00+05:30").toISOString());
    const r = dateRange({ from: "2026-09-01", to: "2026-09-10", day: "2026-09-05" })!;
    expect(r.gte?.toISOString()).toBe(new Date("2026-09-05T00:00:00+05:30").toISOString());
    expect(r.lt?.toISOString()).toBe(new Date("2026-09-06T00:00:00+05:30").toISOString());
  });
  it("ignores invalid values", () => {
    expect(dateRange({ month: "nope", from: "13-13-2026" })).toBeUndefined();
  });
});
