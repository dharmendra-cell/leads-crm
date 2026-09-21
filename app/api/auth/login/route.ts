import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const user = email ? await prisma.user.findUnique({ where: { email: email.toLowerCase() } }) : null;
  const ok = user && password && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !ok) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  await setSessionCookie({ uid: user.id, oid: user.orgId, name: user.name, role: user.role });
  return NextResponse.json({ ok: true });
}
