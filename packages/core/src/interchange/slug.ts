/**
 * File-name slugs for the interchange folder (spec §5.4.2): slugified, de-duplicated with `-2`,
 * `-3`. Deterministic so an export → import → export round trip produces the same names.
 */

/** Lowercase, ASCII-safe, dash-separated. Keeps ukrainian/cyrillic letters (they are legal in a
 * folder a writer browses), drops everything that would break a file name on Windows or Android. */
export function slugify(text: string, fallback = "untitled"): string {
  const cleaned = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/['"`´’]/g, "")
    .replace(/[\\/:*?<>|#%&{}$!@+=[\]();,]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Slugs for a list of titles, de-duplicated in order (`scene`, `scene-2`, `scene-3`). */
export function uniqueSlugs(titles: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base = slugify(title);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

/** `01`, `02`, … — zero-padded so a folder listing sorts like the outline does. */
export function numberPrefix(index: number, width = 2): string {
  return String(index).padStart(width, "0");
}
