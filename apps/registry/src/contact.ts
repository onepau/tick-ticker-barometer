/**
 * Contact form logic: validation, anti-spam and storage. No external service.
 *
 * Spam defences: a hidden honeypot field; a minimum fill time enforced with a signed
 * timestamp (HMAC of the render time, so it cannot be forged or back-dated); and at most
 * five messages per hashed IP address per hour. Honeypot hits and too-fast posts get the
 * normal thank-you page and store nothing, so a bot learns nothing.
 */

export const MIN_FILL_MS = 4_000;
export const TOKEN_MAX_AGE_MS = 24 * 3_600_000;
export const RATE_LIMIT_PER_HOUR = 5;
export const MAX_MESSAGE = 5_000;
export const MAX_BODY_BYTES = 30_000;
export const DEFAULT_SALT = "tick-ticker-contact";

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(salt: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** "<render time in ms>.<signature>", placed in a hidden field when the form is rendered. */
export async function makeToken(salt: string, now: number): Promise<string> {
  return `${now}.${(await hmac(salt, String(now))).slice(0, 32)}`;
}

export type TokenCheck = "ok" | "too_fast" | "expired" | "invalid";

export async function checkToken(salt: string, token: string, now: number): Promise<TokenCheck> {
  const m = /^(\d{10,15})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return "invalid";
  if ((await hmac(salt, m[1]!)).slice(0, 32) !== m[2]) return "invalid";
  const age = now - Number(m[1]);
  if (age < MIN_FILL_MS) return "too_fast";
  if (age > TOKEN_MAX_AGE_MS) return "expired";
  return "ok";
}

/** A page path from ?page= or the form: a local path only, never a URL. */
export function cleanPage(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length <= 200 && /^\/[A-Za-z0-9\-._~/%#?=&]*$/.test(s) && !s.startsWith("//") ? s : "";
}

export interface ContactValues {
  name: string;
  email: string;
  page: string;
  message: string;
}

export function readValues(body: Record<string, unknown>): ContactValues {
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  return {
    name: str("name").trim(),
    email: str("email").trim(),
    page: cleanPage(body.page),
    message: str("message").replace(/\r\n/g, "\n").trim(),
  };
}

export function validate(v: ContactValues): string[] {
  const errors: string[] = [];
  if (!v.message) errors.push("Please write a message.");
  else if (v.message.length > MAX_MESSAGE) errors.push(`Please keep the message under ${MAX_MESSAGE} characters (it is ${v.message.length}).`);
  if (v.name.length > 200) errors.push("Please shorten the name.");
  if (v.email && (v.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)))
    errors.push("That email address does not look right. Leave it empty if you do not want a reply.");
  return errors;
}

export type SubmitResult =
  | { kind: "stored" }
  | { kind: "silent" }
  | { kind: "errors"; errors: string[] }
  | { kind: "limited" }
  | { kind: "unavailable" };

export interface SubmitInput {
  db: D1Database;
  salt: string;
  ip: string;
  now: number;
  body: Record<string, unknown>;
}

export async function submitContact({ db, salt, ip, now, body }: SubmitInput): Promise<SubmitResult> {
  // Honeypot: real visitors never see this field.
  if (typeof body.website === "string" && body.website.trim() !== "") return { kind: "silent" };
  const tokenState = await checkToken(salt, typeof body.t === "string" ? body.t : "", now);
  if (tokenState === "too_fast") return { kind: "silent" };
  if (tokenState === "invalid") return { kind: "silent" };
  const values = readValues(body);
  const errors = validate(values);
  if (tokenState === "expired") errors.push("The form timed out. Please check your message and send it again.");
  if (errors.length) return { kind: "errors", errors };

  const ipHash = await sha256Hex(`${ip}:${salt}`);
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM contact_messages WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`)
      .bind(ipHash)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= RATE_LIMIT_PER_HOUR) return { kind: "limited" };
    await db
      .prepare(`INSERT INTO contact_messages (name, email, page, message, ip_hash) VALUES (?, ?, ?, ?, ?)`)
      .bind(values.name || null, values.email || null, values.page || null, values.message, ipHash)
      .run();
  } catch (e) {
    // Most likely migration 0011 has not been applied yet: say so politely, never a 500.
    console.error("contact store failed", e);
    return { kind: "unavailable" };
  }
  return { kind: "stored" };
}
