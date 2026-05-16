import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { DashShell, Eyebrow } from "@/components/design";
import { ApiInstructionsBlock } from "@/components/dashboard/api-instructions-block";
import { buildDashNav } from "@/lib/dashboard/nav-config";

export const metadata = {
  title: "Payment received | bkstr",
};

export const dynamic = "force-dynamic";

// Phase 3 Stream 3 — post-Checkout landing page.
// Stripe redirects here with ?session_id=cs_test_...; we retrieve the Session
// to surface the book title and a confirmation. The actual access_grant is
// provisioned asynchronously by the payment_intent.succeeded webhook handler,
// so we display "provisioning in progress" + a refresh hint rather than
// pretending the grant is already live (which would race the webhook).
//
// bkstr redesign PR 7 — migrated to <DashShell> + design-token chrome.

export default async function PurchaseSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const params = await searchParams;
  const sessionId = params.session_id ?? null;

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { id: true, companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;

  let bookId: string | null = null;
  let bookTitle: string | null = null;
  let bookSlug: string | null = null;
  let amountTotalCents: number | null = null;
  let stripeError: string | null = null;
  if (sessionId) {
    try {
      const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
      const metaBookId = checkoutSession.metadata?.book_id;
      amountTotalCents = checkoutSession.amount_total ?? null;
      if (metaBookId) {
        const book = await prisma.book.findUnique({
          where: { id: metaBookId },
          select: { id: true, title: true, slug: true },
        });
        bookId = book?.id ?? null;
        bookTitle = book?.title ?? null;
        bookSlug = book?.slug ?? null;
      }
    } catch (err) {
      stripeError = err instanceof Error ? err.message : "Failed to retrieve session";
    }
  }

  return (
    <DashShell
      nav={buildDashNav(session.user.role, "/dashboard")}
      brandSubtitle={companyName.toUpperCase()}
      userBlock={<UserBlock email={userEmail} />}
    >
      <div className="max-w-2xl">
        <header className="mb-6">
          <Eyebrow>§ CHECKOUT · CONFIRMATION RECEIPT</Eyebrow>
          <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
            Payment received
          </h1>
          <p className="text-ink-3 text-sm">
            Access provisioning in progress. The grant is created by Stripe&apos;s
            webhook delivery and is usually visible within seconds.
          </p>
        </header>

        <div className="bg-paper border border-rule p-6 space-y-5">
          {bookTitle && (
            <div>
              <Eyebrow>BOOK</Eyebrow>
              <div className="font-serif text-[22px] tracking-display text-ink mt-1.5">{bookTitle}</div>
            </div>
          )}
          {amountTotalCents !== null && (
            <div>
              <Eyebrow>AMOUNT</Eyebrow>
              <div className="font-serif text-[22px] tracking-display text-ink num tabular-nums mt-1.5">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                  amountTotalCents / 100,
                )}
              </div>
            </div>
          )}
          {sessionId && (
            <div>
              <Eyebrow>STRIPE CHECKOUT SESSION</Eyebrow>
              <div className="font-mono text-[11px] mt-1.5 text-ink-3 break-all">{sessionId}</div>
            </div>
          )}
          {stripeError && (
            <div className="bg-status-err/10 border border-status-err/30 text-status-err text-sm px-4 py-3">
              Could not retrieve the Checkout Session from Stripe: {stripeError}
            </div>
          )}
          {!sessionId && (
            <div className="bg-status-warn/10 border border-status-warn/30 text-status-warn text-sm px-4 py-3">
              No <code className="font-mono">session_id</code> on this URL — landed here without a Stripe redirect.
            </div>
          )}
          <p className="text-sm text-ink-2">
            Your access grant should be live within a few seconds.{" "}
            <Link
              href="/dashboard/library?filter=active"
              className="text-ink underline hover:no-underline"
            >
              Open the Library
            </Link>{" "}
            to see the &ldquo;Access granted&rdquo; pill and the View / Download
            buttons on this book.
          </p>
        </div>

        {subscriber && bookId && bookSlug && (
          <div className="mt-8">
            {/* Post-Checkout = a paid book by construction (free items are
                never routed through Stripe), so isFree is always false.
                apiKey="" — a fresh buyer typically has no key yet; the
                block renders the "Create an API key →" guidance. */}
            <ApiInstructionsBlock
              kind="book"
              itemId={bookId}
              itemSlug={bookSlug}
              subscriberId={subscriber.id}
              apiKey=""
              isFree={false}
            />
          </div>
        )}
      </div>
    </DashShell>
  );
}

function UserBlock({ email }: { email: string }) {
  return (
    <>
      <div className="text-ink text-[13px] mb-1 truncate">{email}</div>
      <div className="flex justify-between items-center text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full bg-status-ok inline-block"
          />
          Signed in
        </span>
        <a
          href="/api/auth/signout"
          className="text-ink-3 hover:text-ink transition-colors"
        >
          Log out
        </a>
      </div>
    </>
  );
}
