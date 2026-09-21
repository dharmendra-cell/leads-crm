import * as XLSX from "xlsx";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildWhere, filtersFromParams } from "@/lib/filters";
import { statusLabel } from "@/lib/constants";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const where = buildWhere(s.oid, filtersFromParams(new URL(req.url).searchParams));
  const leads = await prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: 50000, include: { interactions: { orderBy: { createdAt: "asc" } } } });
  const rows = leads.map((l) => ({
    Source: l.source, Name: l.name ?? "", Company: l.company ?? "", Phone: l.phone ?? "", "Alt phone": l.altPhone ?? "", Email: l.email ?? "",
    City: l.city ?? "", State: l.state ?? "", Requirement: l.requirement ?? "", Status: statusLabel(l.status), Attempts: l.callAttempts,
    "Next follow-up": l.nextFollowUp?.toISOString().slice(0, 10) ?? "", Score: l.score,
    History: l.interactions.map((i) => `[${i.createdAt.toISOString().slice(0, 10)}] ${i.note ?? i.outcome ?? ""}`).join(" | "),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="leads.xlsx"' } });
}
