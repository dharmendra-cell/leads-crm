import { NextResponse } from "next/server";
import { getSession, unauthorized } from "@/lib/auth";
import { rescoreAll } from "@/lib/ranking";

export const maxDuration = 60;

/** Re-score all leads with the saved rules. */
export async function POST() {
  const s = await getSession();
  if (!s) return unauthorized();
  return NextResponse.json(await rescoreAll(s.oid));
}
