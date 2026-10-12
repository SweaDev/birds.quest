"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clearFailedLogins, createSession, destroySession, isLoginBlocked, recordFailedLogin, verifyPassword } from "@/lib/auth";
import { SESSION_COOKIE, clientIp, requireAdminAction, sessionCookieOptions } from "@/lib/admin";
import { getConfig } from "@/lib/config";
import { requestRegenerate, savePost, setPublished } from "@/lib/post-admin";
import { triggerWorker } from "@/lib/run-queue-now";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return { error: "Enter your password." };
  }

  const db = getDb();
  const ip = await clientIp();
  if (await isLoginBlocked(db, ip)) {
    return { error: "Too many failed attempts. Please wait 15 minutes and try again." };
  }

  const config = getConfig();
  if (!(await verifyPassword(password, config.adminPasswordHash))) {
    await recordFailedLogin(db, ip);
    return { error: "That password is not right." };
  }

  await clearFailedLogins(db, ip);
  const session = await createSession(db, config.sessionSecret);
  (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  redirect("/admin");
}

export async function logoutAction(formData: FormData) {
  await requireAdminAction(formData);
  const jar = await cookies();
  await destroySession(getDb(), jar.get(SESSION_COOKIE)?.value, getConfig().sessionSecret);
  jar.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

const idOf = (formData: FormData): number => {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
};

export async function savePostAction(formData: FormData) {
  await requireAdminAction(formData);
  const id = idOf(formData);
  await savePost(getDb(), id, String(formData.get("title") ?? ""), String(formData.get("markdown") ?? ""));
  redirect(`/admin/posts/${id}?saved=1`);
}

export async function publishAction(formData: FormData) {
  await requireAdminAction(formData);
  const id = idOf(formData);
  await setPublished(getDb(), id, formData.get("publish") === "1");
  redirect(`/admin/posts/${id}?${formData.get("publish") === "1" ? "published=1" : "unpublished=1"}`);
}

export async function regenerateAction(formData: FormData) {
  await requireAdminAction(formData);
  const id = idOf(formData);
  const codes = formData.getAll("species").filter((v): v is string => typeof v === "string");
  try {
    await requestRegenerate(getDb(), id, codes);
  } catch (error) {
    redirect(`/admin/posts/${id}?error=${encodeURIComponent((error as Error).message)}`);
  }
  triggerWorker();
  redirect(`/admin/posts/${id}?regenerating=1`);
}

export async function runQueueAction(formData: FormData) {
  await requireAdminAction(formData);
  triggerWorker();
  redirect("/admin?started=1");
}
