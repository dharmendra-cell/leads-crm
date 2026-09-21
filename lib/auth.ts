import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, signSession, verifySession, type Session } from "./jwt";

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export async function setSessionCookie(s: Session) {
  (await cookies()).set(COOKIE, await signSession(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
