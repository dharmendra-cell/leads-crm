/**
 * Normalise a raw cell to E.164-ish. Returns null if unusable.
 * Accepts Indian mobiles (6-9xxxxxxxxx), landlines written as STD+number (10 digits, e.g. 4068106585)
 * or with a leading 0 (07942960896), and international numbers when prefixed with "+".
 * Zero-width/invisible characters (common in IndiaMART exports) are stripped by the digit filter.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[​-‏‪-‮﻿]/g, "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const hadPlus = s.startsWith("+");
  let d = digits;
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 13 && d.startsWith("091")) d = d.slice(3);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[2-9]/.test(d)) return `+91${d}`;
  if (hadPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** A cell may hold several numbers ("98765 43210 / 98111 22233"). Returns [primary, alt]. */
export function extractPhones(raw: unknown): [string | null, string | null] {
  if (raw === null || raw === undefined) return [null, null];
  const parts = String(raw).split(/[,/;|\n]+/);
  const found: string[] = [];
  for (const p of parts) {
    const n = normalizePhone(p);
    if (n && !found.includes(n)) found.push(n);
  }
  return [found[0] ?? null, found[1] ?? null];
}
