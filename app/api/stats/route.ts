import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { filtersFromParams } from "@/lib/filters";
import { getStats } from "@/lib/stats";
import { DIMENSIONS, type Dimension } from "@/lib/constants";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const by = (DIMENSIONS as readonly string[]).includes(sp.get("by") ?? "") ? (sp.get("by") as Dimension) : "source";
  return NextResponse.json(await getStats(s.oid, filtersFromParams(sp), by));
}
