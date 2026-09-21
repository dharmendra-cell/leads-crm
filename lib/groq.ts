import Groq from "groq-sdk";

export const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

let client: Groq | null | undefined;
/** Returns null when no key is configured so every caller can degrade gracefully. */
export function groq(): Groq | null {
  if (client !== undefined) return client;
  const key = process.env.GROQ_API_KEY;
  client = key ? new Groq({ apiKey: key }) : null;
  return client;
}
