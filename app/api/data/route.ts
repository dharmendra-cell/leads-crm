import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const maxDuration = 60;

/** Counts for the "delete everything" confirmation. */
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const [leads, imports] = await Promise.all([prisma.lead.count({ where: { orgId: s.oid } }), prisma.import.count({ where: { orgId: s.oid } })]);
  return NextResponse.json({ leads, imports });
}

/** Delete ALL leads, call history, imports and saved column mappings of this workspace. Accounts stay. Admin only. */
export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  if (s.role !== "ADMIN") return NextResponse.json({ error: "Only an admin can delete data." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "DELETE") return NextResponse.json({ error: 'Type DELETE to confirm.' }, { status: 400 });
  const [leads, imports] = await prisma.$transaction([
    prisma.lead.deleteMany({ where: { orgId: s.oid } }), // interactions cascade
    prisma.import.deleteMany({ where: { orgId: s.oid } }),
    prisma.mappingTemplate.deleteMany({ where: { orgId: s.oid } }),
  ]).then((r) => [r[0], r[1]]);
  return NextResponse.json({ deletedLeads: leads.count, deletedImports: imports.count });
}
