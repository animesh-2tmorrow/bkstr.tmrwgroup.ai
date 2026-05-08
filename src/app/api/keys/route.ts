import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateApiKey } from "@/lib/auth/api-key";

const MAX_NAME_LENGTH = 100;

async function getSubscriberForSession(): Promise<{ subscriberId: string } | null> {
  const session = await auth();
  if (!session?.user?.email) return null;
  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true },
  });
  return subscriber ? { subscriberId: subscriber.id } : null;
}

export async function GET() {
  const ctx = await getSubscriberForSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await prisma.subscriberApiKey.findMany({
    where: { subscriberId: ctx.subscriberId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  const ctx = await getSubscriberForSession();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawName = (body as { name?: unknown })?.name;
  if (typeof rawName !== "string") {
    return NextResponse.json({ error: "name must be a string" }, { status: 400 });
  }
  const name = rawName.trim().slice(0, MAX_NAME_LENGTH);

  const { plaintext, prefix, hash } = generateApiKey();
  const created = await prisma.subscriberApiKey.create({
    data: {
      subscriberId: ctx.subscriberId,
      name,
      keyPrefix: prefix,
      keyHash: hash,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    id: created.id,
    name: created.name,
    plaintext,
    prefix: created.keyPrefix,
    createdAt: created.createdAt,
  });
}
