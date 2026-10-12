import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  return (
    <>
      <header className="site-header">
        <div className="container admin-nav">
          <Link href="/admin" className="logo">
            <span className="logo-mark" aria-hidden="true">
              🐦
            </span>
            Admin
          </Link>
          <Link href="/admin">Overview</Link>
          <Link href="/admin/posts">Posts</Link>
          <Link href="/" target="_blank">
            View site ↗
          </Link>
          <form action={logoutAction}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <button className="btn secondary" type="submit">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="container admin-main">{children}</main>
    </>
  );
}
