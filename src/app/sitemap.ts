import type { MetadataRoute } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { posts } from "@/db/schema";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rows = await getDb()
    .select({ slug: posts.slug, publishedAt: posts.publishedAt })
    .from(posts)
    .where(eq(posts.status, "published"))
    .orderBy(desc(posts.publishedAt));
  return [
    { url: siteUrl(), changeFrequency: "weekly" },
    ...rows.map((row) => ({
      url: `${siteUrl()}/posts/${row.slug}`,
      lastModified: row.publishedAt ?? undefined,
    })),
  ];
}
