import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { posts } from "@/db/schema";
import { summarizePost } from "@/lib/post-utils";
import { SITE_TAGLINE } from "@/lib/site";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export default async function Home() {
  // Only public columns are read: no trip id, times or coordinates.
  const rows = await getDb()
    .select({ slug: posts.slug, title: posts.title, markdown: posts.markdown, publishedAt: posts.publishedAt })
    .from(posts)
    .where(eq(posts.status, "published"))
    .orderBy(desc(posts.publishedAt));

  return (
    <>
      <section className="hero">
        <div className="container">
          <span className="pill">Bird watching, reimagined</span>
          <h1>Who might be singing out there?</h1>
          <p>{SITE_TAGLINE}</p>
        </div>
      </section>

      <div className="container">
        {rows.length === 0 ? (
          <div className="empty">
            <p>🪺 No posts yet. The first walk is on its way.</p>
          </div>
        ) : (
          <div className="grid">
            {rows.map((row) => {
              const summary = summarizePost(row.markdown);
              return (
                <Link key={row.slug} href={`/posts/${row.slug}`} className="card">
                  {summary.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="card-cover" src={summary.cover} alt="" loading="lazy" />
                  ) : (
                    <div className="card-cover placeholder" aria-hidden="true">
                      🐦
                    </div>
                  )}
                  <div className="card-body">
                    <h2>{row.title}</h2>
                    <p>{summary.excerpt}</p>
                    <div className="meta">
                      <span>{summary.speciesCount} species</span>
                      {row.publishedAt && <span>{dateFormat.format(row.publishedAt)}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
