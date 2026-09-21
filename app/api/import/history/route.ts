import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const rows = await prisma.import.findMany({ where: { orgId: s.oid }, orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json(rows.map((r) => ({ ...r, steps: JSON.parse(r.steps) })));
}
