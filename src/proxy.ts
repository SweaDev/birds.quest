import { NextResponse, type NextRequest } from "next/server";

const isProd = process.env.NODE_ENV === "production";
const SESSION_COOKIE = isProd ? "__Host-bq_session" : "bq_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cheap early redirect only; every admin page and action still verifies the session in the database.
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isAdminArea && pathname !== "/admin/login" && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org",
    "font-src 'self'",
    `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isProd) response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  if (isAdminArea) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
