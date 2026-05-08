import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SignOutLink } from "@/components/auth/sign-out-link";
import { ApiKeysList } from "@/components/api-keys/api-keys-list";

export const metadata = {
  title: "API Keys | bkstr",
};

export default async function ApiKeysPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  const subscriber = await prisma.subscriber.findFirst({
    where: { user: { email: session.user.email } },
    select: { companyName: true },
  });
  const companyName = subscriber?.companyName ?? "Personal";
  const userEmail = session.user.email;
  const initial = (session.user.name?.[0] ?? userEmail[0] ?? "?").toUpperCase();

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-[#FAF6EC] border-r border-[#E5DCC8] flex flex-col">
        <div className="p-6 border-b border-[#E5DCC8]">
          <div className="text-2xl font-bold serif italic">bkstr</div>
          <div className="text-xs font-semibold text-gray-500 mt-1 uppercase tracking-wider">
            {companyName}
          </div>
        </div>
        <nav className="flex-grow p-4 space-y-1 text-sm font-medium text-gray-600">
          <Link href="/dashboard" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
            Active Books
          </Link>
          <Link href="/dashboard/api-keys" className="block px-4 py-2.5 rounded-lg nav-item active">
            API Keys
          </Link>
          <a href="#" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
            Usage Metrics
          </a>
          <a href="#" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
            Team Access
          </a>
          <a href="#" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
            Billing
          </a>
        </nav>
        <div className="p-6 border-t border-[#E5DCC8]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-[#EAE2D0] flex items-center justify-center text-xs font-bold text-gray-600">
              {initial}
            </div>
            <div className="text-sm font-medium truncate">{userEmail}</div>
          </div>
          <SignOutLink />
        </div>
      </aside>

      <main className="flex-grow p-8 max-w-6xl">
        <ApiKeysList />
      </main>
    </div>
  );
}
