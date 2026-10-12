import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <h1>🪹 Nothing nesting here</h1>
      <p>That page does not exist, or it has not been published yet.</p>
      <Link href="/">Back to the posts</Link>
    </div>
  );
}
