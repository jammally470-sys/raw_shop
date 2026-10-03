const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");

const root = process.cwd();
const port = Number(process.env.PORT || 5500);

function loadEnvFile() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || `http://localhost:${port}/auth/callback`;
const supabaseDatabasePassword = process.env.SUPABASE_DATABASE_PASSWORD;
const supabaseDatabaseConnectionString = process.env.SUPABASE_DATABASE_CONNECTION_STRING?.trim();
const secureCookies = process.env.NODE_ENV === "production" || redirectUri.startsWith("https://");
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const stateLifetimeMs = 5 * 60 * 1000;
const sessions = new Map();
const pendingAuth = new Map();
let supabasePool;
let usersTableReady;

class SupabaseConfigurationError extends Error {}

function safeDatabaseErrorCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 3; depth++, current = current.cause) {
    const code = typeof current.code === "string" ? current.code : "";
    if (/^[A-Z0-9_]{2,24}$/.test(code)) return code;
  }
  return "unknown";
}

function safeDatabaseErrorCategory(error) {
  const code = safeDatabaseErrorCode(error);
  if (/^(28P01|28000|28P02)$/.test(code)) return "authentication";
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "dns";
  if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)$/.test(code)) return "network";
  if (/^(CERT_|ERR_TLS|ERR_SSL)/.test(code)) return "tls";
  const message = String(error?.message || error?.cause?.message || "");
  if (/password authentication|SASL|client password must be a string/i.test(message)) return "authentication";
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(message)) return "dns";
  if (/timeout|timed out|connection terminated|connect ECONN|network/i.test(message)) return "network";
  if (/certificate|TLS|SSL/i.test(message)) return "tls";
  if (/permission denied|not authorized|no pg_hba/i.test(message)) return "permissions";
  if (/relation .* does not exist|column .* does not exist/i.test(message)) return "schema";
  return "unknown";
}

function getSupabasePool() {
  if (supabasePool) return supabasePool;
  if (!supabaseDatabasePassword || !supabaseDatabaseConnectionString) {
    throw new SupabaseConfigurationError("Supabase database configuration is missing");
  }

  let connectionUrl;
  try {
    connectionUrl = new URL(supabaseDatabaseConnectionString);
    if (!["postgres:", "postgresql:"].includes(connectionUrl.protocol)) throw new Error("Unsupported database protocol");
  } catch {
    throw new SupabaseConfigurationError("Supabase database connection string is invalid");
  }

  // The password is supplied separately so reserved characters are safely URL encoded.
  connectionUrl.password = supabaseDatabasePassword;
  connectionUrl.searchParams.set("uselibpqcompat", "true");
  connectionUrl.searchParams.set("sslmode", "require");
  supabasePool = new Pool({
    connectionString: connectionUrl.toString(),
    max: 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
  });
  supabasePool.on("error", (error) => {
    console.error(`[Supabase] idle database connection error (${safeDatabaseErrorCategory(error)}; ${safeDatabaseErrorCode(error)})`);
  });
  return supabasePool;
}

async function ensureUsersTable() {
  if (!usersTableReady) {
    usersTableReady = (async () => {
      const pool = getSupabasePool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.users (
          google_sub TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          full_name TEXT NOT NULL,
          avatar_url TEXT,
          email_verified BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_sign_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query("ALTER TABLE public.users ENABLE ROW LEVEL SECURITY");
    })().catch((error) => {
      usersTableReady = null;
      throw error;
    });
  }
  return usersTableReady;
}

async function saveGoogleUser(profile) {
  await ensureUsersTable();
  const pool = getSupabasePool();
  await pool.query(`
    INSERT INTO public.users
      (google_sub, email, full_name, avatar_url, email_verified, created_at, updated_at, last_sign_in_at)
    VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW(), NOW())
    ON CONFLICT (google_sub) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = EXCLUDED.full_name,
      avatar_url = EXCLUDED.avatar_url,
      email_verified = TRUE,
      updated_at = NOW(),
      last_sign_in_at = NOW()
  `, [profile.sub, profile.email, profile.name || profile.email, profile.picture || null]);
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function parseCookies(request) {
  const cookies = {};
  for (const part of (request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { cookies[name] = decodeURIComponent(value); } catch { cookies[name] = ""; }
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const attributes = [
    `Path=${options.path || "/"}`,
    `SameSite=${options.sameSite || "Lax"}`,
    "HttpOnly",
  ];
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  if (secureCookies) attributes.push("Secure");
  return `${name}=${encodeURIComponent(value)}; ${attributes.join("; ")}`;
}

function expiredCookie(name, pathName = "/") {
  return `${name}=; Path=${pathName}; SameSite=Lax; HttpOnly; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureCookies ? "; Secure" : ""}`;
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function redirect(response, location, setCookies = []) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": setCookies,
  });
  response.end();
}

function authConfigIsPresent() {
  return Boolean(googleClientId && googleClientSecret);
}

function sendAuthSetupMessage(response) {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google sign-in setup</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:620px;margin:12vh auto;padding:24px;color:#172425"><h1>Google sign-in needs setup</h1><p>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to the local <code>.env</code> file, then restart this server.</p><p>In Google Cloud Console, add <code>${redirectUri.replace(/[&<>\"]/g, "")}</code> as an authorized redirect URI for this web client.</p><p><a href="/">Return to Coretech by Jamal</a></p></body></html>`;
  response.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(body);
}

function getSession(request) {
  const sessionId = parseCookies(request).coretech_session;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, session };
}

async function handleGoogleCallback(request, response, requestUrl) {
  const cookies = parseCookies(request);
  const state = requestUrl.searchParams.get("state") || "";
  const stateCookie = cookies.coretech_oauth_state || "";
  const pending = pendingAuth.get(state);
  pendingAuth.delete(state);
  const clearState = expiredCookie("coretech_oauth_state", "/auth/callback");
  const fail = (reason) => redirect(response, `/?auth=${encodeURIComponent(reason)}`, [clearState]);

  if (!state || !stateCookie || state !== stateCookie || !pending || pending.expiresAt <= Date.now()) {
    console.warn("[Google OAuth] state validation failed");
    fail("state");
    return;
  }
  if (requestUrl.searchParams.has("error")) {
    const providerError = requestUrl.searchParams.get("error");
    console.warn(`[Google OAuth] provider returned ${providerError === "access_denied" ? "access_denied" : "an error"}`);
    fail(providerError === "access_denied" ? "cancelled" : "provider");
    return;
  }

  const code = requestUrl.searchParams.get("code");
  if (!code || !authConfigIsPresent()) {
    console.warn("[Google OAuth] callback missing code or server credentials");
    fail("config");
    return;
  }

  let stage = "token";
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: pending.codeVerifier,
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.warn(`[Google OAuth] token exchange failed (${tokenData.error || tokenResponse.status})`);
      fail("token");
      return;
    }

    stage = "profile";
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) {
      console.warn(`[Google OAuth] profile lookup failed (HTTP ${profileResponse.status})`);
      fail("profile");
      return;
    }
    if (!profile.sub || !profile.email || profile.email_verified !== true) {
      console.warn("[Google OAuth] Google returned an incomplete or unverified profile");
      fail("profile");
      return;
    }

    try {
      await saveGoogleUser(profile);
    } catch (error) {
      const reason = error instanceof SupabaseConfigurationError ? "database-config" : "database";
      console.error(`[Google OAuth] Supabase user save failed (${safeDatabaseErrorCategory(error)}; ${safeDatabaseErrorCode(error)})`);
      fail(reason);
      return;
    }

    const sessionId = crypto.randomBytes(32).toString("base64url");
    sessions.set(sessionId, {
      user: {
        id: profile.sub,
        name: profile.name || profile.email,
        email: profile.email,
        picture: profile.picture || "",
      },
      expiresAt: Date.now() + sessionLifetimeSeconds * 1000,
    });
    redirect(response, "/?auth=success", [
      cookie("coretech_session", sessionId, { maxAge: sessionLifetimeSeconds }),
      clearState,
    ]);
  } catch (error) {
    console.error(`[Google OAuth] ${stage} request failed (${error.name || "Error"})`);
    fail("network");
  }
}

async function handleRequest(request, response) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url, `http://localhost:${port}`);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/auth/google") {
    if (!authConfigIsPresent()) return sendAuthSetupMessage(response);

    const state = crypto.randomBytes(32).toString("base64url");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    pendingAuth.set(state, { codeVerifier, expiresAt: Date.now() + stateLifetimeMs });

    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.search = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      include_granted_scopes: "true",
    }).toString();
    redirect(response, googleUrl.toString(), [
      cookie("coretech_oauth_state", state, { path: "/auth/callback", maxAge: Math.floor(stateLifetimeMs / 1000) }),
    ]);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/auth/callback") {
    await handleGoogleCallback(request, response, requestUrl);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/session") {
    const active = getSession(request);
    sendJson(response, 200, active ? { authenticated: true, user: active.session.user } : { authenticated: false });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/auth/logout") {
    const active = getSession(request);
    if (active) sessions.delete(active.sessionId);
    response.writeHead(204, {
      "Cache-Control": "no-store",
      "Set-Cookie": expiredCookie("coretech_session"),
    });
    response.end();
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD, POST" }).end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (pathname.split("/").some((segment) => segment.startsWith("."))) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const filename = path.resolve(root, `.${pathname}`);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filename, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

if (process.argv.includes("--ensure-users-table")) {
  ensureUsersTable()
    .then(() => console.log("[Supabase] public.users table is ready."))
    .catch((error) => {
      const detail = error instanceof SupabaseConfigurationError
        ? "database configuration is missing or invalid"
        : `database operation failed (${error.name || "Error"})`;
      console.error(`[Supabase] Could not prepare public.users: ${detail} (${safeDatabaseErrorCategory(error)}; ${safeDatabaseErrorCode(error)}).`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (supabasePool) await supabasePool.end();
    });
} else {
  setInterval(() => {
    const now = Date.now();
    for (const [state, pending] of pendingAuth) if (pending.expiresAt <= now) pendingAuth.delete(state);
    for (const [sessionId, session] of sessions) if (session.expiresAt <= now) sessions.delete(sessionId);
  }, 60_000).unref();

  http.createServer((request, response) => {
    handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Server error");
    });
  }).listen(port, process.env.HOST || "127.0.0.1");
}
