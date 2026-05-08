import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Subscriber, SubscriberApiKey } from "@/generated/prisma/client";

const KEY_PREFIX_TAG = "bks_";
const SECRET_BYTES = 24;
const PREFIX_LENGTH = KEY_PREFIX_TAG.length + 8;
const PREFIX_REGEX = /^bks_[A-Za-z0-9_-]{8}$/;

export class ApiKeyAuthError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyAuthError";
    this.status = 401;
  }
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function extractPrefix(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length < PREFIX_LENGTH || !plaintext.startsWith(KEY_PREFIX_TAG)) {
    throw new ApiKeyAuthError("Invalid key format");
  }
  return plaintext.slice(0, PREFIX_LENGTH);
}

export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const secret = toBase64Url(randomBytes(SECRET_BYTES));
  const plaintext = `${KEY_PREFIX_TAG}${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX_LENGTH),
    hash: hashApiKey(plaintext),
  };
}

function constantTimeHashEqual(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aHex, "hex"), Buffer.from(bHex, "hex"));
  } catch {
    return false;
  }
}

export async function requireApiKey(
  request: Request,
): Promise<{ apiKey: SubscriberApiKey; subscriber: Subscriber }> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) throw new ApiKeyAuthError("Missing Authorization header");

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new ApiKeyAuthError("Invalid Authorization header");
  }

  if (!PREFIX_REGEX.test(token.slice(0, PREFIX_LENGTH))) {
    throw new ApiKeyAuthError("Invalid key");
  }

  const prefix = token.slice(0, PREFIX_LENGTH);
  const candidates = await prisma.subscriberApiKey.findMany({
    where: { keyPrefix: prefix, revokedAt: null },
    include: { subscriber: true },
  });

  const candidateHash = hashApiKey(token);
  const match = candidates.find((row) => constantTimeHashEqual(row.keyHash, candidateHash));
  if (!match) throw new ApiKeyAuthError("Invalid key");

  await prisma.subscriberApiKey.update({
    where: { id: match.id },
    data: { lastUsedAt: new Date() },
  });

  const { subscriber, ...apiKey } = match;
  return { apiKey, subscriber };
}
