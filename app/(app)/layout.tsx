import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

const NAV = [
  ["/dashboard", "Dashboard"],
  ["/leads", "Leads"],
  ["/import", "Import"],
  ["/ask", "Ask & Insights"],
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
          <span className="font-semibold">Lead CRM</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-gray-600 hover:text-black">{label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-gray-600">
            {s.name}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
