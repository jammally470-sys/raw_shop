const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
const secureCookies = process.env.NODE_ENV === "production" || redirectUri.startsWith("https://");
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const stateLifetimeMs = 5 * 60 * 1000;
const sessions = new Map();
const pendingAuth = new Map();

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
    fail("error");
    return;
  }
  if (requestUrl.searchParams.has("error")) {
    fail(requestUrl.searchParams.get("error") === "access_denied" ? "cancelled" : "error");
    return;
  }

  const code = requestUrl.searchParams.get("code");
  if (!code || !authConfigIsPresent()) {
    fail("error");
    return;
  }

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
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Token exchange failed");

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
      throw new Error("Google profile could not be verified");
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
  } catch {
    fail("error");
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
