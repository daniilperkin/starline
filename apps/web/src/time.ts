/** Compact relative time for banners, snapshots and trash rows ("12 min ago"). */
export function relativeTime(ms: number | null): string {
  if (ms === null) return "unknown";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}
