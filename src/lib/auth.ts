import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { adminSessions, loginAttempts } from "@/db/schema";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_FAILED_PER_IP = 5;
export const MAX_FAILED_GLOBAL = 30;

// OWASP-recommended argon2id parameters.
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

// A real hash of a throwaway value, verified when the configured hash is unusable, so timing stays similar.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Z2hbV0p2d2xYQYTfAWm5vWQGq0V0m+q2nfJ3vC0Xk8E";

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    await verify(DUMMY_HASH, password).catch(() => false);
    return false;
  }
}

/** Keyed hash of a session token; only this is stored, never the token itself. */
export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type NewSession = { token: string; csrfToken: string; expiresAt: Date };

export async function createSession(db: Db, secret: string, now: Date = new Date()): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  await db.insert(adminSessions).values({
    tokenHash: hashToken(token, secret),
    csrfToken,
    expiresAt,
    lastUsedAt: now,
  });
  return { token, csrfToken, expiresAt };
}

export type ActiveSession = { id: number; csrfToken: string };

export async function findSession(
  db: Db,
  token: string | undefined,
  secret: string,
  now: Date = new Date(),
): Promise<ActiveSession | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: adminSessions.id, csrfToken: adminSessions.csrfToken })
    .from(adminSessions)
    .where(and(eq(adminSessions.tokenHash, hashToken(token, secret)), gt(adminSessions.expiresAt, now)));
  return row ?? null;
}

export async function destroySession(db: Db, token: string | undefined, secret: string): Promise<void> {
  if (!token) return;
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token, secret)));
}

export function csrfValid(session: Pick<ActiveSession, "csrfToken">, submitted: unknown): boolean {
  return typeof submitted === "string" && safeEqual(session.csrfToken, submitted);
}

/** True when this IP (or the whole site) has had too many recent failed logins. */
export async function isLoginBlocked(db: Db, ip: string, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [perIp] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.attemptedAt, since)));
  if (perIp.n >= MAX_FAILED_PER_IP) return true;
  const [total] = await db.select({ n: count() }).from(loginAttempts).where(gt(loginAttempts.attemptedAt, since));
  return total.n >= MAX_FAILED_GLOBAL;
}

export async function recordFailedLogin(db: Db, ip: string, now: Date = new Date()): Promise<void> {
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - LOGIN_WINDOW_MS)));
  await db.insert(loginAttempts).values({ ip, attemptedAt: now });
}

export async function clearFailedLogins(db: Db, ip: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip));
}
