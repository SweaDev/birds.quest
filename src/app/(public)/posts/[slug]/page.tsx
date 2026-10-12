import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Markdown } from "@/components/Markdown";
import { getDb } from "@/db";
import { posts } from "@/db/schema";
import { summarizePost } from "@/lib/post-utils";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

async function getPublishedPost(slug: string) {
  const [post] = await getDb()
    .select({ slug: posts.slug, title: posts.title, markdown: posts.markdown, publishedAt: posts.publishedAt })
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, "published")));
  return post;
}

export async function generateMetadata({ params }: PageProps<"/posts/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) return {};
  const { excerpt, cover } = summarizePost(post.markdown, 160);
  return {
    title: post.title,
    description: excerpt,
    alternates: { canonical: `/posts/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: excerpt,
      publishedTime: post.publishedAt?.toISOString(),
      images: cover ? [cover] : undefined,
    },
  };
}

export default async function PostPage({ params }: PageProps<"/posts/[slug]">) {
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) notFound();
  const { speciesCount } = summarizePost(post.markdown);

  return (
    <article>
      <header className="article-head narrow">
        <span className="pill">Field notes</span>
        <h1>{post.title}</h1>
        <div className="meta">
          <span>{speciesCount} species</span>
          {post.publishedAt && <time dateTime={post.publishedAt.toISOString()}>{dateFormat.format(post.publishedAt)}</time>}
        </div>
      </header>
      <div className="narrow prose">
        <Markdown>{post.markdown}</Markdown>
        <Link href="/" className="back">
          ← All posts
        </Link>
      </div>
    </article>
  );
}
