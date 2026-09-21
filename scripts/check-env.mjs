// Runs before `prisma migrate deploy` in the build. Prints which env vars the build can see (names + lengths only).
try { await import("dotenv/config"); } catch { /* dotenv only matters locally; Vercel injects real env vars and dotenv never overrides them */ }
const seen = Object.keys(process.env).filter((k) => /^(DATABASE|DIRECT_URL|POSTGRES|NEON|PG[A-Z]*_|AUTH_SECRET|GROQ|HF_TOKEN|ALLOW_REG)/i.test(k)).sort();
console.log("Build env check (names and lengths only):");
for (const k of seen) {
  const v = process.env[k] ?? "";
  console.log(`  ${k}: ${v.length ? `${v.length} chars${/URL/.test(k) ? `, starts with "${v.slice(0, 13)}"` : ""}` : "EMPTY"}`);
}
const missing = ["DATABASE_URL", "DIRECT_URL", "AUTH_SECRET"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\nMissing or empty in this build: ${missing.join(", ")}`);
  console.error("Vercel -> Project -> Settings -> Environment Variables: add them for the Production environment, then Redeploy.");
  console.error(`Names visible to the build: ${seen.join(", ") || "(none)"}`);
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL) || !/^postgres(ql)?:\/\//.test(process.env.DIRECT_URL)) {
  console.error("\nDATABASE_URL / DIRECT_URL must start with postgresql:// (no quotes, no spaces).");
  process.exit(1);
}
