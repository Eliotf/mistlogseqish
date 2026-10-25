/**
 * Readable page addresses (/page/<slug>, PRD F2). Slugs keep letters and
 * digits from any script, accents included, lowercased; anything else becomes
 * a single "-". The workspace index assigns them and resolves clashes.
 */

export const MAX_SLUG_LENGTH = 80;

/** The slug for a title, or "" if it has no letters or digits. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const chars = Array.from(slug); // code points, so no letter is split in half
  if (chars.length <= MAX_SLUG_LENGTH) return slug;
  // Cut at a dash where possible so words stay whole
  const cut = chars.slice(0, MAX_SLUG_LENGTH).join("");
  const dash = cut.lastIndexOf("-");
  return (dash > MAX_SLUG_LENGTH / 2 ? cut.slice(0, dash) : cut).replace(/-+$/, "");
}

/** The path for a page: its readable slug, or its permanent ID address. */
export function pagePath(pageId: string, slug: string | null): string {
  return slug ? `/page/${encodeURIComponent(slug)}` : `/docs/${pageId}`;
}
