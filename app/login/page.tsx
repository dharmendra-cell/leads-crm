"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ orgName: "", name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setBusy(false);
    if (res.ok) router.replace("/dashboard");
    else setErr((await res.json()).error ?? "Failed");
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 space-y-3">
        <h1 className="text-xl font-semibold">Lead CRM</h1>
        <p className="text-sm text-gray-500">{mode === "login" ? "Sign in to your workspace" : "Create your workspace"}</p>
        {mode === "register" && (
          <>
            <input className="input" placeholder="Company / workspace name" value={f.orgName} onChange={set("orgName")} required />
            <input className="input" placeholder="Your name" value={f.name} onChange={set("name")} required />
          </>
        )}
        <input className="input" type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
        <input className="input" type="password" placeholder="Password (8+ characters)" value={f.password} onChange={set("password")} required minLength={8} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "..." : mode === "login" ? "Sign in" : "Create workspace"}</button>
        <button type="button" className="text-sm text-gray-500 underline w-full" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New here? Create a workspace" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
