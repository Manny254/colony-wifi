import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";

const SESSION_COOKIE_NAME = "colony_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function getJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ADMIN_JWT_SECRET is missing or too short. Generate one with: openssl rand -base64 48"
    );
  }
  return secret;
}

interface AdminSessionPayload {
  adminId: string;
  email: string;
}

export async function verifyAdminPassword(email: string, password: string) {
  const admin = await db.admin.findUnique({ where: { email } });
  if (!admin || !admin.active) return null;

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) return null;

  return admin;
}

export function signAdminSessionToken(payload: AdminSessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: SESSION_TTL_SECONDS });
}

export function verifyAdminSessionToken(token: string): AdminSessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AdminSessionPayload;
  } catch {
    return null;
  }
}

export const ADMIN_SESSION_COOKIE = {
  name: SESSION_COOKIE_NAME,
  maxAgeSeconds: SESSION_TTL_SECONDS,
  // httpOnly + secure + sameSite=lax: not readable from JS, not sent
  // cross-site, only over HTTPS in production (section 24/31).
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  },
};

/**
 * Reads and verifies the admin session from the request. Returns null
 * if absent/invalid/expired — callers must treat null as "reject the
 * request," never assume a default identity.
 */
export function getAdminSession(req: NextRequest): AdminSessionPayload | null {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE.name)?.value;
  if (!token) return null;
  return verifyAdminSessionToken(token);
}
