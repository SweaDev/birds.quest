import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { POST_STATUSES, posts } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { summarizePost } from "@/lib/post-utils";

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" },
] as const;

export default async function AdminPosts({ searchParams }: PageProps<"/admin/posts">) {
  await requireAdmin();
  const { status } = await searchParams;
  const filter = POST_STATUSES.find((s) => s === status);

  const rows = await getDb()
    .select({
      id: posts.id,
      title: posts.title,
      status: posts.status,
      markdown: posts.markdown,
      generatedAt: posts.generatedAt,
      editedAt: posts.editedAt,
    })
    .from(posts)
    .where(filter ? eq(posts.status, filter) : undefined)
    .orderBy(desc(posts.id));

  return (
    <>
      <h1>Posts</h1>
      <nav className="tabs" aria-label="Filter posts">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/admin/posts" : `/admin/posts?status=${f.key}`}
            aria-current={(filter ?? "all") === f.key ? "page" : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <section className="panel">
        {rows.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Species</th>
                  <th>Generated</th>
                  <th>Edited</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/posts/${p.id}`}>{p.title}</Link>
                    </td>
                    <td>
                      <span className={`badge ${p.status}`}>{p.status}</span>
                    </td>
                    <td>{summarizePost(p.markdown).speciesCount}</td>
                    <td>{p.generatedAt ? date.format(p.generatedAt) : "–"}</td>
                    <td>{p.editedAt ? date.format(p.editedAt) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
