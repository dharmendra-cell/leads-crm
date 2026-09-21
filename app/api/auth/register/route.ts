import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

const Body = z.object({
  orgName: z.string().min(2).max(100),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  // On a public deployment, close sign-ups after creating your own workspace (ALLOW_REGISTRATION=false).
  if (process.env.ALLOW_REGISTRATION === "false" && (await prisma.user.count()) > 0)
    return NextResponse.json({ error: "Sign-ups are closed. Ask the workspace admin for access." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter org name, your name, a valid email and 8+ char password" }, { status: 400 });
  const { orgName, name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  const user = await prisma.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN", org: { create: { name: orgName } } },
  });
  await setSessionCookie({ uid: user.id, oid: user.orgId, name: user.name, role: user.role });
  return NextResponse.json({ ok: true });
}
