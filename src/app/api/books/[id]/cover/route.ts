/**
 * POST /api/books/[id]/cover — Phase 5 Stream H (D15.6).
 *
 * Accepts a multipart/form-data upload with a single `cover` file field.
 * Validates the file is an image (JPEG / PNG / WebP / GIF — max 5MB), uploads
 * it to S3 under `book-covers/<bookId>.<ext>`, then writes the public HTTPS
 * URL back to books.cover_image_url.
 *
 * Auth: PUBLISHER (own books only) or ADMIN (any book). Returns
 * { coverImageUrl: string } on success.
 *
 * S3:
 *   - Bucket: bkstr-tmrw-prod (us-east-1)
 *   - Key pattern: book-covers/<bookId>.<ext>
 *   - Public-read via bucket policy (NOT per-object ACL — bucket has Object
 *     Ownership = BucketOwnerEnforced, so ACLs are disabled). The
 *     `arn:aws:s3:::bkstr-tmrw-prod/book-covers/*` PublicRead policy
 *     statement is staged separately by the operator per
 *     docs/operations.md "Cover images" runbook.
 *   - Reuses the singleton `s3Client` from @/lib/storage/book-content (D9.2 /
 *     D9.4) — that client uses the default AWS credentials chain (env vars
 *     from /etc/bkstr/aws.env, falling back to IMDSv2 instance profile).
 *     One S3Client per process — see follow-up #99 if covers ever need
 *     cross-account credentials separate from the book-content bucket.
 */

import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { s3Client } from "@/lib/storage/book-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "bkstr-tmrw-prod";
const REGION = "us-east-1";
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: bookId } = await params;

  const session = await auth();
  if (!session?.user?.email || !session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== Role.PUBLISHER && session.user.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: "PUBLISHER or ADMIN role required" },
      { status: 403 },
    );
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { id: true, title: true, publisherUserId: true },
  });
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  if (
    session.user.role === Role.PUBLISHER &&
    book.publisherUserId !== session.user.id
  ) {
    return NextResponse.json(
      { error: "Forbidden — not your book" },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("cover");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'cover' file field" },
      { status: 400 },
    );
  }

  const mimeType = file.type.toLowerCase();
  const ext = ALLOWED_MIME[mimeType];
  if (!ext) {
    return NextResponse.json(
      {
        error: `Unsupported file type '${file.type}'. Allowed: JPEG, PNG, WebP, GIF.`,
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `File too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`,
      },
      { status: 400 },
    );
  }

  const key = `book-covers/${bookId}.${ext}`;
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          "book-id": bookId,
          "book-title": book.title.slice(0, 128),
          "uploaded-by": session.user.email,
        },
      }),
    );
  } catch (err) {
    console.error(`[books/${bookId}/cover] S3 upload failed:`, err);
    return NextResponse.json(
      { error: "Failed to upload cover image to storage. Please try again." },
      { status: 502 },
    );
  }

  const coverImageUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

  await prisma.book.update({
    where: { id: bookId },
    data: { coverImageUrl },
  });

  console.log(
    `[books/${bookId}/cover] Cover uploaded by ${session.user.email}: ${coverImageUrl}`,
  );

  return NextResponse.json({ coverImageUrl }, { status: 200 });
}
