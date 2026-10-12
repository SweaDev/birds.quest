export type PostSummary = { excerpt: string; cover: string | null; speciesCount: number };

const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Short teaser, first image and species count, derived from the post's Markdown. */
export function summarizePost(markdown: string, maxChars = 180): PostSummary {
  const intro = markdown.split(/^##\s/m)[0];
  let excerpt = plain(intro);
  if (excerpt.length > maxChars) excerpt = `${excerpt.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  const cover = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(markdown)?.[1] ?? null;
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)].filter((m) => !/^final thoughts$/i.test(m[1].trim()));
  return { excerpt, cover, speciesCount: headings.length };
}
