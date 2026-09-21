import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE } from "@/lib/jwt";

export async function POST() {
  (await cookies()).delete(COOKIE);
  return NextResponse.json({ ok: true });
}
