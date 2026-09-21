import { statusColor, statusLabel } from "@/lib/constants";

export default function StatusBadge({ status }: { status: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusColor(status)}`}>{statusLabel(status)}</span>;
}
