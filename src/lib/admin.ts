import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getConfig } from "./config";
import { csrfValid, findSession, type ActiveSession } from "./auth";

const SECURE = process.env.NODE_ENV === "production";
// The __Host- prefix pins the cookie to this exact host over HTTPS (production only; it needs Secure).
export const SESSION_COOKIE = SECURE ? "__Host-bq_session" : "bq_session";

export const sessionCookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: SECURE,
  sameSite: "lax" as const,
  path: "/",
  expires,
});

/** The current admin session, or null. Cached per request. */
export const getAdminSession = cache(async (): Promise<ActiveSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findSession(getDb(), token, getConfig().sessionSecret);
});

/** Call at the top of every admin page and server action. */
export async function requireAdmin(): Promise<ActiveSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

/** For server actions: requires a session and a matching CSRF token from the form. */
export async function requireAdminAction(formData: FormData): Promise<ActiveSession> {
  const session = await requireAdmin();
  if (!csrfValid(session, formData.get("csrf"))) throw new Error("Invalid CSRF token");
  return session;
}

/** Client IP as seen by the reverse proxy (Caddy sets X-Forwarded-For). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return (forwarded || h.get("x-real-ip") || "unknown").slice(0, 64);
}
