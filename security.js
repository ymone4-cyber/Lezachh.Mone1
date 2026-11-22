const encoder = new TextEncoder();
const SESSION_COOKIE = "lezachh_admin_session";

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extraHeaders
    }
  });
}

export function errorResponse(error, fallback = "Une erreur est survenue.") {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  return json({ error: fallback }, 500);
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function dbFor(env) {
  if (!env.DB) throw new HttpError(503, "La base de données n’est pas configurée.");
  return env.DB;
}

export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!origin || origin !== new URL(request.url).origin || site === "cross-site") {
    throw new HttpError(403, "Origine de requête refusée.");
  }
}

export async function readJson(request, maxBytes = 16384) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Format JSON requis.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new HttpError(413, "Requête trop volumineuse.");
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw new HttpError(413, "Requête trop volumineuse.");
  let value;
  try { value = JSON.parse(text); } catch { throw new HttpError(400, "JSON invalide."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Objet JSON attendu.");
  return value;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function sessionSecret(env) {
  const secret = env.ADMIN_SESSION_SECRET || "";
  if (encoder.encode(secret).byteLength < 32) throw new HttpError(503, "La clé de session doit contenir au moins 32 octets.");
  return secret;
}

async function hmacKey(env) {
  return crypto.subtle.importKey("raw", encoder.encode(sessionSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueSession(env, username) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(encoder.encode(JSON.stringify({ iss: "lezachh-admin", sub: username, iat: now, exp: now + 28800 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(payload)));
  return payload + "." + base64url(signature);
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function sessionCookie(request, value, maxAge = 28800) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function isAdmin(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some(part => part.length > 2048)) return false;
  try {
    const key = await hmacKey(env);
    if (!await crypto.subtle.verify("HMAC", key, fromBase64url(parts[1]), encoder.encode(parts[0]))) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    const now = Math.floor(Date.now() / 1000);
    return payload.iss === "lezachh-admin" && typeof payload.sub === "string" && payload.iat <= now + 60 && payload.exp > now && payload.exp - payload.iat <= 28800;
  } catch { return false; }
}

export async function requireAdmin(request, env, mutate = false) {
  if (mutate) requireSameOrigin(request);
  if (!await isAdmin(request, env)) throw new HttpError(401, "Connexion administrateur requise.");
}

export async function verifyPassword(password, encodedHash) {
  const [scheme, roundsText, saltText, hashText, extra] = String(encodedHash || "").split("$");
  const rounds = Number(roundsText);
  if (scheme !== "pbkdf2-sha256" || extra !== undefined || !Number.isInteger(rounds) || rounds < 100000 || rounds > 1000000) return false;
  try {
    const salt = fromBase64url(saltText);
    const expected = fromBase64url(hashText);
    if (salt.length < 16 || expected.length !== 32) return false;
    const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" }, base, 256));
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= derived[i] ^ expected[i];
    return diff === 0;
  } catch { return false; }
}

export async function hashClientKey(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(sessionSecret(env) + ":" + ip));
  return base64url(new Uint8Array(bytes));
}

export function requiredText(value, name, maxLength) {
  if (typeof value !== "string") throw new HttpError(400, `${name} invalide.`);
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) throw new HttpError(400, `${name} invalide.`);
  return text;
}

export function optionalHttpUrl(value, name = "Lien") {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) throw new HttpError(400, `${name} invalide.`);
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, `${name} invalide.`); }
  if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(400, `${name} invalide.`);
  return url.href;
}

export function validId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new HttpError(400, "Identifiant invalide.");
  return value;
}

export function cookieId(request, name) {
  const raw = cookieValue(request, name);
  return /^[0-9a-f-]{36}$/i.test(raw) ? raw : "";
}

export function newId() { return crypto.randomUUID(); }
