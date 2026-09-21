import { prisma } from "./db";

// Local, free, no API key: all-MiniLM-L6-v2 (384 dims). Model (~25MB) downloads on first use.
// Groq has no embeddings endpoint, so embeddings are computed in-process.
type Extractor = (t: string | string[], o: object) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor | null> | null = null;

async function load(): Promise<Extractor | null> {
  try {
    const { pipeline } = await import("@huggingface/transformers");
    return (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")) as unknown as Extractor;
  } catch (e) {
    console.error("Embedding model unavailable (semantic search disabled):", e);
    return null;
  }
}

const HF_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction";

const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

/** Hosted embeddings (same all-MiniLM-L6-v2, 384-d, so vectors are interchangeable with the local model). Used on serverless. */
async function embedHosted(texts: string[]): Promise<number[][] | null> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: texts.slice(i, i + 32), options: { wait_for_model: true } }),
    });
    if (!res.ok) {
      console.error("HF embeddings failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = (await res.json()) as number[][];
    if (!Array.isArray(json) || json.some((v) => !Array.isArray(v) || v.length !== 384)) return null;
    out.push(...json.map(unit));
  }
  return out;
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  if (process.env.HF_TOKEN) return embedHosted(texts);
  // Serverless bundles cannot hold the ~370MB local model; without HF_TOKEN semantic search is simply off.
  if (process.env.VERCEL) return null;
  extractor ??= load();
  const ex = await extractor;
  if (!ex) return null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const res = await ex(texts.slice(i, i + 32), { pooling: "mean", normalize: true });
    out.push(...res.tolist());
  }
  return out;
}

export function leadText(l: {
  name?: string | null; company?: string | null; city?: string | null;
  requirement?: string | null; message?: string | null;
}): string {
  return [l.requirement, l.message, l.company, l.city, l.name].filter(Boolean).join(" | ").slice(0, 600);
}

const vec = (v: number[]) => `[${v.join(",")}]`;

/** Embed leads that have no vector yet. Returns how many were embedded. */
export async function embedPendingLeads(orgId: string, limit = 2000): Promise<number> {
  const rows = await prisma.$queryRaw<
    { id: string; name: string | null; company: string | null; city: string | null; requirement: string | null; message: string | null }[]
  >`SELECT id, name, company, city, requirement, message FROM "Lead"
    WHERE "orgId" = ${orgId} AND embedding IS NULL LIMIT ${limit}`;
  if (!rows.length) return 0;
  const vectors = await embed(rows.map(leadText));
  if (!vectors) return 0;
  for (let i = 0; i < rows.length; i++) {
    await prisma.$executeRaw`UPDATE "Lead" SET embedding = ${vec(vectors[i])}::vector WHERE id = ${rows[i].id}`;
  }
  return rows.length;
}

export interface SemanticHit {
  id: string; name: string | null; company: string | null; city: string | null;
  source: string; status: string; requirement: string | null; phone: string | null; similarity: number;
}

export async function semanticSearch(orgId: string, query: string, limit = 10): Promise<SemanticHit[] | null> {
  const v = await embed([query]);
  if (!v) return null;
  const q = vec(v[0]);
  const rows = await prisma.$queryRaw<SemanticHit[]>`
    SELECT id, name, company, city, source, status, requirement, phone,
           1 - (embedding <=> ${q}::vector) AS similarity
    FROM "Lead" WHERE "orgId" = ${orgId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${q}::vector LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, similarity: Number(Number(r.similarity).toFixed(3)) }));
}
