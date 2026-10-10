import {
  DEFAULT_RETENTION,
  isPinnedReason,
  type RetentionPlan,
  type RetentionPolicy,
  type SnapshotFile,
} from "./types";

/**
 * Retention thinning (spec §4.5.3), pure: given the files and a clock, decide what survives.
 * Keeping this out of the file store means the policy is testable without OPFS, and the store
 * only has to execute the plan.
 *
 * Order of the rules matters:
 *   1. a pinned file (manual / pre_*) is never removed,
 *   2. the newest file is never removed — whatever else the rules say,
 *   3. everything younger than `keepAllMs` stays,
 *   4. then the newest file of each hour up to `hourlyMs`,
 *   5. then the newest file of each day up to `dailyMs`,
 *   6. then the byte cap thins the survivors oldest-first.
 */
export function planRetention(
  files: readonly SnapshotFile[],
  now: number,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): RetentionPlan {
  const newestFirst = [...files].sort((a, b) => b.createdAt - a.createdAt);
  const newest = newestFirst[0];
  const keep = new Set<string>();
  const seenHours = new Set<string>();
  const seenDays = new Set<string>();

  for (const file of newestFirst) {
    if (isPinnedReason(file.reason)) {
      keep.add(file.name);
      continue;
    }
    const age = now - file.createdAt;
    if (age <= policy.keepAllMs) {
      keep.add(file.name);
      continue;
    }
    if (age <= policy.hourlyMs) {
      const hour = hourKey(file.createdAt);
      if (!seenHours.has(hour)) {
        seenHours.add(hour);
        keep.add(file.name);
      }
      continue;
    }
    if (age <= policy.dailyMs) {
      const day = dayKey(file.createdAt);
      if (!seenDays.has(day)) {
        seenDays.add(day);
        keep.add(file.name);
      }
    }
  }

  if (newest) keep.add(newest.name);

  // Byte cap: thin the oldest survivors first, but never a pinned file and never the newest.
  let keepBytes = newestFirst
    .filter((file) => keep.has(file.name))
    .reduce((total, file) => total + file.byteSize, 0);
  if (keepBytes > policy.totalBytesCap) {
    for (const file of [...newestFirst].reverse()) {
      if (keepBytes <= policy.totalBytesCap) break;
      if (!keep.has(file.name)) continue;
      if (file.name === newest?.name || isPinnedReason(file.reason)) continue;
      keep.delete(file.name);
      keepBytes -= file.byteSize;
    }
  }

  const ordered = [...keep];
  return {
    keep: ordered,
    remove: newestFirst.filter((file) => !keep.has(file.name)).map((file) => file.name),
    keepBytes,
  };
}

function hourKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
