import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SignOutLink } from "@/components/auth/sign-out-link";

export const metadata = {
  title: "Dashboard | bkstr",
};

export default async function DashboardPage() {
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
      {/* Sidebar */}
      <aside className="w-64 bg-[#FAF6EC] border-r border-[#E5DCC8] flex flex-col">
        <div className="p-6 border-b border-[#E5DCC8]">
          <div className="text-2xl font-bold serif italic">bkstr</div>
          <div className="text-xs font-semibold text-gray-500 mt-1 uppercase tracking-wider">
            {companyName}
          </div>
        </div>
        <nav className="flex-grow p-4 space-y-1 text-sm font-medium text-gray-600">
          <Link href="/dashboard" className="block px-4 py-2.5 rounded-lg nav-item active">
            Active Books
          </Link>
          <Link href="/dashboard/api-keys" className="block px-4 py-2.5 rounded-lg hover:bg-[#EAE2D0] hover:text-gray-900">
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

      {/* Main Content */}
      <main className="flex-grow p-8 max-w-6xl">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Active Books</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage the knowledge available to your agent fleet.
            </p>
          </div>
          <button className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black transition-colors shadow-sm">
            Browse Registry
          </button>
        </header>

        {/* Stats Overview */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-6 rounded-xl shadow-sm">
            <div className="text-sm font-semibold text-gray-500 mb-2">Total Fetches (30d)</div>
            <div className="text-3xl font-bold compressed-text">14,208</div>
          </div>
          <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-6 rounded-xl shadow-sm">
            <div className="text-sm font-semibold text-gray-500 mb-2">Active Agents</div>
            <div className="text-3xl font-bold compressed-text">42</div>
          </div>
          <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-6 rounded-xl shadow-sm border-l-4 border-l-black">
            <div className="text-sm font-semibold text-gray-500 mb-2">Avg Performance Lift</div>
            <div className="text-3xl font-bold compressed-text text-black">+28.4%</div>
          </div>
        </div>

        {/* Books List */}
        <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-600">Book Title</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Domain</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Fetches</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Lift</th>
                <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
                <th className="px-6 py-4 font-semibold text-gray-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5DCC8]">
              <tr className="hover:bg-[#F5F0E6] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-900">Marketing Operations Playbook</div>
                  <div className="text-xs text-gray-500 font-mono mt-1">ID: mktg-ops-01</div>
                </td>
                <td className="px-6 py-4">
                  <span className="bg-[#EAE2D0] text-gray-700 px-2 py-1 rounded text-xs font-bold">
                    Marketing Ops
                  </span>
                </td>
                <td className="px-6 py-4 font-medium">8,432</td>
                <td className="px-6 py-4">
                  <span className="font-bold compressed-text text-black">+34%</span>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Active
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-black font-semibold underline hover:no-underline">
                    Manage
                  </button>
                </td>
              </tr>
              <tr className="hover:bg-[#F5F0E6] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-900">QA for Agentic Systems</div>
                  <div className="text-xs text-gray-500 font-mono mt-1">ID: qa-sys-04</div>
                </td>
                <td className="px-6 py-4">
                  <span className="bg-[#EAE2D0] text-gray-700 px-2 py-1 rounded text-xs font-bold">
                    Quality Assurance
                  </span>
                </td>
                <td className="px-6 py-4 font-medium">4,105</td>
                <td className="px-6 py-4">
                  <span className="font-bold compressed-text text-black">+41%</span>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Active
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-black font-semibold underline hover:no-underline">
                    Manage
                  </button>
                </td>
              </tr>
              <tr className="hover:bg-[#F5F0E6] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-900">AWS Networking Reference</div>
                  <div className="text-xs text-gray-500 font-mono mt-1">ID: aws-net-09</div>
                </td>
                <td className="px-6 py-4">
                  <span className="bg-[#EAE2D0] text-gray-700 px-2 py-1 rounded text-xs font-bold">
                    Infrastructure
                  </span>
                </td>
                <td className="px-6 py-4 font-medium">1,671</td>
                <td className="px-6 py-4">
                  <span className="font-bold compressed-text text-black">-22%</span>
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Active
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-black font-semibold underline hover:no-underline">
                    Manage
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
