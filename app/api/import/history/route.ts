import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PASTED_LEADS_NAME } from "@/lib/constants";

/** Sheet uploads and pasted leads are listed separately (each capped at 30, newest first). */
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const [uploads, pasted] = await Promise.all([
    prisma.import.findMany({ where: { orgId: s.oid, NOT: { fileName: PASTED_LEADS_NAME } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.import.findMany({ where: { orgId: s.oid, fileName: PASTED_LEADS_NAME }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  // A few lead names per paste, so "who did I paste?" is visible without opening anything.
  const leads = pasted.length
    ? await prisma.lead.findMany({ where: { orgId: s.oid, importId: { in: pasted.map((p) => p.id) } }, select: { importId: true, name: true, company: true, phone: true }, orderBy: { createdAt: "asc" }, take: 300 })
    : [];
  const names = new Map<string, string[]>();
  for (const l of leads) {
    const list = names.get(l.importId!) ?? [];
    if (list.length < 3) list.push(l.name || l.company || l.phone || "lead");
    names.set(l.importId!, list);
  }
  return NextResponse.json({
    uploads: uploads.map((r) => ({ ...r, steps: JSON.parse(r.steps) })),
    pasted: pasted.map((r) => ({ ...r, steps: JSON.parse(r.steps), leadNames: names.get(r.id) ?? [] })),
  });
}
