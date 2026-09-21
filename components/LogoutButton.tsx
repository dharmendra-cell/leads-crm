"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button className="btn" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }}>
      Log out
    </button>
  );
}
