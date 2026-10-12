import Link from "next/link";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="site-header">
        <div className="container">
          <Link href="/" className="logo">
            <span className="logo-mark" aria-hidden="true">
              🐦
            </span>
            birds.quest
          </Link>
          <span className="muted">Predicted, never pinpointed</span>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="container">
          <p>
            Species are predictions from the season and the route, not confirmed sightings. No locations are ever
            shown. Text and photos from Wikipedia and Wikimedia Commons.
          </p>
        </div>
      </footer>
    </>
  );
}
