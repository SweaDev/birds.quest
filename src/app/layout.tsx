import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "birds.quest",
  description: "Birds you might spot on a walk, predicted from the season and the route.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
