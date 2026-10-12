import Link from "next/link";
import { count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, posts, trips } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { getRunState } from "@/lib/run-queue-now";
import { importKmlAction, runQueueAction } from "../actions";
import { AutoRefresh } from "./AutoRefresh";

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const fmt = (d: Date | null) => (d ? `${dateTime.format(d)} UTC` : "–");

function duration(start: Date, end: Date): string {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  const session = await requireAdmin();
  const { started, imported, importExisting, importError } = await searchParams;
  const db = getDb();

  const [tripRows, jobRows, [drafts], [published], [pending]] = await Promise.all([
    // Coordinates are deliberately not selected: the admin never needs them either.
    db
      .select({
        id: trips.id,
        startedAt: trips.startedAt,
        endedAt: trips.endedAt,
        status: trips.status,
        speciesCount: sql<number>`(select count(*) from predictions p where p.trip_id = ${trips.id})`,
        postId: posts.id,
        postStatus: posts.status,
      })
      .from(trips)
      .leftJoin(posts, eq(posts.tripId, trips.id))
      .orderBy(desc(trips.startedAt))
      .limit(30),
    db.select().from(jobs).orderBy(desc(jobs.id)).limit(12),
    db.select({ n: count() }).from(posts).where(eq(posts.status, "draft")),
    db.select({ n: count() }).from(posts).where(eq(posts.status, "published")),
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, "pending")),
  ]);
  const run = getRunState();
  const busy = run.running || jobRows.some((j) => j.status === "running");

  return (
    <>
      <AutoRefresh active={busy} />
      <h1>Overview</h1>

      <div className="stats">
        <div className="stat">
          <strong>{tripRows.length}</strong>
          <span>recent trips</span>
        </div>
        <div className="stat">
          <strong>{drafts.n}</strong>
          <span>drafts</span>
        </div>
        <div className="stat">
          <strong>{published.n}</strong>
          <span>published</span>
        </div>
        <div className="stat">
          <strong>{pending.n}</strong>
          <span>jobs waiting</span>
        </div>
      </div>

      <section className="panel">
        <div className="row between">
          <div>
            <h2>Worker</h2>
            <p className="muted">
              {run.running
                ? `Running since ${fmt(run.startedAt ?? null)}. Posts can take a few minutes.`
                : run.error
                  ? `Last run failed: ${run.error}`
                  : run.summary
                    ? `Last run finished: ${run.summary.succeeded} ok, ${run.summary.retried} to retry, ${run.summary.failed} failed.`
                    : "Finds new trips, predicts species and writes draft posts. Also runs hourly on the server."}
            </p>
            {started && <p className="notice">Worker started.</p>}
          </div>
          <form action={runQueueAction}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <button className="btn" type="submit" disabled={run.running}>
              {run.running ? "Running…" : "▶ Run queue now"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <h2>Import a track</h2>
        <p className="muted">
          Upload a <code>.kml</code> route (for example a Traccar export) to create a trip by hand. Species are predicted and a draft post is
          written, the same as for a recorded walk. Times found in the file are used; fill in the fields below only if the file has none, or to
          override them. Times are UTC.
        </p>
        {imported && <p className="notice">Track imported. The worker is predicting species and writing the draft.</p>}
        {importExisting && <p className="notice">This track was imported before. The worker was started to finish any pending steps.</p>}
        {typeof importError === "string" && <p className="error">{importError}</p>}
        <form action={importKmlAction}>
          <input type="hidden" name="csrf" value={session.csrfToken} />
          <div className="field">
            <label htmlFor="kml-file">KML file (2 MB at most)</label>
            <input id="kml-file" type="file" name="file" accept=".kml,application/vnd.google-earth.kml+xml" required />
          </div>
          <div className="import-times">
            <div className="field">
              <label htmlFor="kml-start">Started (UTC, optional)</label>
              <input id="kml-start" type="datetime-local" name="start" />
            </div>
            <div className="field">
              <label htmlFor="kml-end">Ended (UTC, optional)</label>
              <input id="kml-end" type="datetime-local" name="end" />
            </div>
          </div>
          <button className="btn" type="submit" disabled={run.running}>
            Import and run
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Trips</h2>
        {tripRows.length === 0 ? (
          <p className="muted">No trips yet. Record a walk with the Traccar Client.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Species</th>
                  <th>Post</th>
                </tr>
              </thead>
              <tbody>
                {tripRows.map((t) => (
                  <tr key={t.id}>
                    <td>{fmt(t.startedAt)}</td>
                    <td>{duration(t.startedAt, t.endedAt)}</td>
                    <td>
                      <span className={`badge ${t.status}`}>{t.status}</span>
                    </td>
                    <td>{t.speciesCount}</td>
                    <td>
                      {t.postId ? (
                        <Link href={`/admin/posts/${t.postId}`}>
                          Open <span className={`badge ${t.postStatus}`}>{t.postStatus}</span>
                        </Link>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Recent jobs</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Status</th>
                <th>Tries</th>
                <th>Updated</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {jobRows.map((j) => (
                <tr key={j.id}>
                  <td>{j.id}</td>
                  <td>{j.type}</td>
                  <td>
                    <span className={`badge ${j.status}`}>{j.status}</span>
                  </td>
                  <td>
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td>{fmt(j.updatedAt)}</td>
                  <td className="muted">{j.lastError?.slice(0, 140) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
