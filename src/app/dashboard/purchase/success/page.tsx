import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ApiInstructionsBlock } from "@/components/dashboard/api-instructions-block";

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
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

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
    <DashboardShell
      active="books"
      companyName={companyName}
      userEmail={userEmail}
      initial={initial}
      role={session.user.role}
    >
      <div className="max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Payment received</h1>
          <p className="text-sm text-gray-500 mt-1">
            Access provisioning in progress. The grant is created by Stripe&apos;s webhook delivery
            and is usually visible within seconds.
          </p>
        </header>

        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm p-6 space-y-4">
          {bookTitle && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Book
              </div>
              <div className="text-lg font-bold mt-1">{bookTitle}</div>
            </div>
          )}
          {amountTotalCents !== null && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Amount
              </div>
              <div className="text-lg font-bold mt-1">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                  amountTotalCents / 100,
                )}
              </div>
            </div>
          )}
          {sessionId && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Stripe Checkout Session
              </div>
              <div className="text-xs font-mono mt-1 text-gray-600 break-all">{sessionId}</div>
            </div>
          )}
          {stripeError && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
              Could not retrieve the Checkout Session from Stripe: {stripeError}
            </div>
          )}
          {!sessionId && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm px-4 py-3 rounded-lg">
              No <code>session_id</code> on this URL — landed here without a Stripe redirect.
            </div>
          )}
          <p className="text-sm text-gray-600">
            Your access grant should be live within a few seconds.{" "}
            <Link href="/dashboard/library?filter=active" className="font-semibold underline hover:no-underline">
              Open the Library
            </Link>{" "}
            to see the &ldquo;Access granted&rdquo; pill and the View / Download
            buttons on this book.
          </p>
        </div>

        {subscriber && bookId && (
          <div className="mt-6">
            <ApiInstructionsBlock
              subscriberId={subscriber.id}
              bookId={bookId}
              bookSlug={bookSlug ?? undefined}
            />
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
