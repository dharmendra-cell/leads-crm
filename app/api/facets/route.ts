import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Option lists for the filter bar. Cities narrow to the chosen state. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const state = new URL(req.url).searchParams.get("state") || undefined;
  const [states, cities] = await Promise.all([
    prisma.lead.groupBy({ by: ["state"], where: { orgId: s.oid, state: { not: null } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["city"], where: { orgId: s.oid, city: { not: null }, ...(state && { state }) }, _count: { _all: true } }),
  ]);
  const top = <T extends { _count: { _all: number } }>(a: T[]) => a.sort((x, y) => y._count._all - x._count._all).slice(0, 400);
  return NextResponse.json({
    states: top(states).map((r) => r.state as string).sort(),
    cities: top(cities).map((r) => r.city as string).sort(),
  });
}
