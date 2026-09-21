import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** What deleting this import would remove, so the UI can warn before anything is lost. */
export async function GET(_: Request, { params }: Ctx) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await params;
  const imp = await prisma.import.findFirst({ where: { id, orgId: s.oid }, select: { id: true } });
  if (!imp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [leads, touched] = await Promise.all([
    prisma.lead.count({ where: { orgId: s.oid, importId: id } }),
    // Leads where someone logged calls/notes in the app (imported remarks and system notes do not count).
    prisma.lead.count({
      where: { orgId: s.oid, importId: id, interactions: { some: { userName: { not: null }, NOT: { userName: "imported" } } } },
    }),
  ]);
  return NextResponse.json({ leads, withLoggedCalls: touched });
}

/** Delete an import and every lead it created (their history goes with them). Admin only. */
export async function DELETE(_: Request, { params }: Ctx) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (s.role !== "ADMIN") return NextResponse.json({ error: "Only an admin can delete imports." }, { status: 403 });
  const { id } = await params;
  const imp = await prisma.import.findFirst({ where: { id, orgId: s.oid }, select: { id: true } });
  if (!imp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [leads] = await prisma.$transaction([
    prisma.lead.deleteMany({ where: { orgId: s.oid, importId: id } }), // interactions cascade
    prisma.import.delete({ where: { id } }),
  ]);
  return NextResponse.json({ deletedLeads: leads.count });
}
