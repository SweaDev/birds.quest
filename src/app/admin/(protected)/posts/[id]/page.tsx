import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { postSpecies, posts, predictions } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { getRunState } from "@/lib/run-queue-now";
import { publishAction, regenerateAction } from "../../../actions";
import { AutoRefresh } from "../../AutoRefresh";
import { PostEditor } from "./PostEditor";

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function AdminPost({ params, searchParams }: PageProps<"/admin/posts/[id]">) {
  const session = await requireAdmin();
  const { id: rawId } = await params;
  const flags = await searchParams;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) notFound();

  const species = post.tripId
    ? await db
        .select({
          code: predictions.speciesCode,
          commonName: predictions.commonName,
          probability: predictions.probability,
        })
        .from(predictions)
        .where(eq(predictions.tripId, post.tripId))
        .orderBy(desc(predictions.probability))
    : [];
  const selection = new Map(
    (await db.select().from(postSpecies).where(eq(postSpecies.postId, id))).map((r) => [r.speciesCode, r.selected]),
  );
  const regenerating = flags.regenerating !== undefined || getRunState().running;

  return (
    <>
      <AutoRefresh active={getRunState().running} />
      <div className="row between">
        <div>
          <Link href="/admin/posts">← Posts</Link>
          <h1>{post.title}</h1>
        </div>
        <div className="row">
          <span className={`badge ${post.status}`}>{post.status}</span>
          {post.status === "published" && (
            <Link className="btn secondary" href={`/posts/${post.slug}`} target="_blank">
              View ↗
            </Link>
          )}
          <form action={publishAction}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="publish" value={post.status === "published" ? "0" : "1"} />
            <button className={post.status === "published" ? "btn danger" : "btn"} type="submit">
              {post.status === "published" ? "Unpublish" : "🚀 Publish"}
            </button>
          </form>
        </div>
      </div>

      {flags.saved && <p className="notice">Saved.</p>}
      {flags.published && <p className="notice">Published. It is now on the public site.</p>}
      {flags.unpublished && <p className="notice">Back to draft. It is no longer public.</p>}
      {regenerating && (
        <p className="notice">Regenerating with your species list. This page updates when the new text is ready.</p>
      )}
      {typeof flags.error === "string" && <p className="error">{flags.error}</p>}

      <section className="panel">
        <h2>Species you actually saw</h2>
        {species.length === 0 ? (
          <p className="muted">This post is not linked to a trip, so it cannot be regenerated.</p>
        ) : (
          <form action={regenerateAction}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <input type="hidden" name="id" value={post.id} />
            <ul className="species-list">
              {species.map((s) => (
                <li key={s.code}>
                  <label>
                    <input type="checkbox" name="species" value={s.code} defaultChecked={selection.get(s.code) ?? true} />
                    <span>{s.commonName}</span>
                    <small>{Math.round(s.probability * 100)}%</small>
                  </label>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn" type="submit" disabled={getRunState().running}>
                ✨ Regenerate with selected species
              </button>
              <span className="muted">Rewrites the text below, replacing manual edits. Probabilities are model estimates.</span>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Edit</h2>
        <p className="muted">
          Generated {post.generatedAt ? `${dateTime.format(post.generatedAt)} UTC` : "–"}
          {post.editedAt ? `, edited ${dateTime.format(post.editedAt)} UTC` : ""}.
        </p>
        <PostEditor
          key={`${post.updatedAt.getTime()}`}
          id={post.id}
          csrf={session.csrfToken}
          initialTitle={post.title}
          initialMarkdown={post.markdown}
        />
      </section>
    </>
  );
}
