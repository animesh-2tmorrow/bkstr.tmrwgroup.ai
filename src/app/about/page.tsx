import Link from "next/link";

// Phase 5 Stream H.1 — marketing landing relocated from `/` to `/about`.
// `/` now redirects to `/storefront` (ecommerce-first per Edward's direction).
// The marketing copy is preserved here for visitors who want the
// "How bkstr works / Pricing tiers / Compression pipeline" narrative.
// Added a "Browse books" CTA in the header so this page bounces back
// into the storefront flow rather than dead-ending.

export const metadata = {
  title: "About bkstr | Compressed Knowledge for AI Agents",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-6 flex justify-between items-center bg-[#FAF6EC]/80 backdrop-blur-sm sticky top-0 z-10 border-b border-[#E5DCC8]">
        <Link href="/about" className="text-2xl font-bold tracking-tighter serif italic no-underline">
          bkstr
          <span
            className="text-gray-400 font-normal text-lg not-italic"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            .tmrwgroup.ai
          </span>
        </Link>
        <nav className="space-x-6 text-sm font-semibold flex items-center">
          <Link href="/storefront" className="text-gray-600 hover:text-black transition-colors">
            Browse books
          </Link>
          <Link href="/login" className="text-gray-600 hover:text-black transition-colors">
            Log in
          </Link>
          <Link
            href="/signup"
            className="accent-bg text-[#FAF6EC] px-5 py-2.5 rounded-sm hover:bg-black transition-colors"
          >
            Start trial
          </Link>
        </nav>
      </header>

      <main className="flex-grow px-6 py-20 max-w-7xl mx-auto w-full space-y-32">
        {/* Hero */}
        <section className="text-center max-w-4xl mx-auto space-y-8">
          <div className="inline-block bg-[#EAE2D0] text-xs font-bold px-3 py-1 rounded-full text-gray-700 mb-4 uppercase tracking-wider">
            Agent Infrastructure
          </div>
          <h1 className="text-6xl md:text-7xl font-bold leading-tight">
            High-density knowledge.<br />
            <span className="italic">Zero context waste.</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Domain expertise compressed into structured, machine-first formats. Equip your
            internal AI agents with the exact context they need to perform measurably better.
          </p>
          <div className="pt-8 flex justify-center gap-4">
            <Link
              href="/storefront"
              className="accent-bg text-[#FAF6EC] px-8 py-4 rounded-sm font-bold text-lg hover:bg-black transition-colors shadow-lg shadow-black/20"
            >
              Browse books
            </Link>
            <Link
              href="/signup"
              className="bg-[#FAF6EC] text-black border border-black px-8 py-4 rounded-sm font-bold text-lg hover:bg-[#EAE2D0] transition-colors"
            >
              Start free trial
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-[#FAF6EC] border border-[#E5DCC8] p-12 rounded-2xl shadow-sm">
          <h2 className="text-3xl font-bold mb-12 text-center">The Compression Pipeline</h2>
          <div className="grid md:grid-cols-3 gap-12 relative">
            <div className="hidden md:block absolute top-8 left-1/6 right-1/6 h-0.5 bg-[#E5DCC8] -z-10"></div>

            <div className="text-center bg-[#FAF6EC]">
              <div className="w-16 h-16 mx-auto bg-[#EAE2D0] border border-[#E5DCC8] rounded-full flex items-center justify-center text-2xl font-bold mb-6">
                1
              </div>
              <h3 className="text-xl font-bold mb-3">Expertise Extraction</h3>
              <p className="text-gray-600">
                Domain experts distill their playbooks into core principles and patterns.
              </p>
            </div>
            <div className="text-center bg-[#FAF6EC]">
              <div className="w-16 h-16 mx-auto bg-[#EAE2D0] border border-[#E5DCC8] text-black rounded-full flex items-center justify-center text-2xl font-bold mb-6">
                2
              </div>
              <h3 className="text-xl font-bold mb-3">Structural Compression</h3>
              <p className="text-gray-600">
                Content is reformatted into high-density, agent-optimized structures.
              </p>
            </div>
            <div className="text-center bg-[#FAF6EC]">
              <div className="w-16 h-16 mx-auto bg-[#EAE2D0] border border-[#E5DCC8] rounded-full flex items-center justify-center text-2xl font-bold mb-6">
                3
              </div>
              <h3 className="text-xl font-bold mb-3">Fleet Deployment</h3>
              <p className="text-gray-600">
                Agents fetch compressed books via API, instantly improving task accuracy.
              </p>
            </div>
          </div>
        </section>

        {/* Featured Books */}
        <section>
          <div className="flex justify-between items-end mb-10">
            <h2 className="text-3xl font-bold">Registry Highlights</h2>
            <Link href="/storefront" className="text-sm font-bold text-gray-900 hover:underline">
              Browse all &rarr;
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-6 rounded-xl hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start mb-4">
                <div className="bg-[#EAE2D0] text-xs font-bold px-2 py-1 rounded text-gray-700">
                  Marketing Ops
                </div>
                <div className="text-xs font-mono text-gray-400">42kb</div>
              </div>
              <h3 className="text-xl font-bold mb-2 group-hover:text-black transition-colors">
                Marketing Operations Playbook
              </h3>
              <p className="text-sm text-gray-500 mb-6">By Etumos</p>
              <div className="bg-[#EAE2D0] p-3 rounded-lg flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-700">Performance Lift</span>
                <span className="font-bold compressed-text text-black">+34%</span>
              </div>
            </div>
            <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-6 rounded-xl hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start mb-4">
                <div className="bg-[#EAE2D0] text-xs font-bold px-2 py-1 rounded text-gray-700">
                  Quality Assurance
                </div>
                <div className="text-xs font-mono text-gray-400">88kb</div>
              </div>
              <h3 className="text-xl font-bold mb-2 group-hover:text-black transition-colors">
                QA for Agentic Systems
              </h3>
              <p className="text-sm text-gray-500 mb-6">By Tmrwgroup</p>
              <div className="bg-[#EAE2D0] p-3 rounded-lg flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-700">Performance Lift</span>
                <span className="font-bold compressed-text text-black">+41%</span>
              </div>
            </div>
            <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-6 rounded-xl hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start mb-4">
                <div className="bg-[#EAE2D0] text-xs font-bold px-2 py-1 rounded text-gray-700">
                  Infrastructure
                </div>
                <div className="text-xs font-mono text-gray-400">156kb</div>
              </div>
              <h3 className="text-xl font-bold mb-2 group-hover:text-black transition-colors">
                AWS Networking Reference
              </h3>
              <p className="text-sm text-gray-500 mb-6">By NetArch</p>
              <div className="bg-[#EAE2D0] p-3 rounded-lg flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-700">Error Reduction</span>
                <span className="font-bold compressed-text text-black">-22%</span>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section>
          <h2 className="text-3xl font-bold mb-12 text-center">Simple, Transparent Pricing</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-8 rounded-xl shadow-sm">
              <h3 className="text-xl font-bold mb-2">Starter</h3>
              <p className="text-sm text-gray-500 mb-6">Small teams getting started</p>
              <div className="mb-6">
                <div className="text-2xl font-bold text-gray-900 mb-1">Custom</div>
                <p className="text-xs text-gray-500">Contact us for pricing</p>
              </div>
              <ul className="space-y-3 mb-8 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Up to 25 agents</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>5 active book subscriptions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Standard API rate limits</span>
                </li>
              </ul>
              <button className="w-full bg-[#FAF6EC] border border-black text-gray-900 font-bold py-2.5 rounded-lg hover:bg-[#EAE2D0] transition-colors">
                Start trial
              </button>
            </div>

            <div className="bg-[#FAF6EC] border-2 border-black p-8 rounded-xl shadow-md relative">
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-black text-[#FAF6EC] text-xs font-bold px-3 py-1 rounded-full">
                Recommended
              </div>
              <h3 className="text-xl font-bold mb-2">Growth</h3>
              <p className="text-sm text-gray-500 mb-6">Scaling teams</p>
              <div className="mb-6">
                <div className="text-2xl font-bold text-gray-900 mb-1">Custom</div>
                <p className="text-xs text-gray-500">Contact us for pricing</p>
              </div>
              <ul className="space-y-3 mb-8 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Up to 250 agents</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Unlimited book subscriptions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Elevated API rate limits</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Priority support</span>
                </li>
              </ul>
              <button className="w-full accent-bg text-[#FAF6EC] font-bold py-2.5 rounded-lg hover:bg-black transition-colors">
                Start trial
              </button>
            </div>

            <div className="bg-[#FAF6EC] border border-[#E5DCC8] p-8 rounded-xl shadow-sm">
              <h3 className="text-xl font-bold mb-2">Enterprise</h3>
              <p className="text-sm text-gray-500 mb-6">Large fleets</p>
              <div className="mb-6">
                <div className="text-2xl font-bold text-gray-900 mb-1">Custom</div>
                <p className="text-xs text-gray-500">Contact us for pricing</p>
              </div>
              <ul className="space-y-3 mb-8 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Unlimited agents</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Custom skill ingestion</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Dedicated infrastructure</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>SOC 2 + HIPAA compliance</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-black font-bold mt-0.5">&bull;</span>
                  <span>Named support contact</span>
                </li>
              </ul>
              <button className="w-full bg-[#FAF6EC] border border-black text-gray-900 font-bold py-2.5 rounded-lg hover:bg-[#EAE2D0] transition-colors">
                Contact sales
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#EFE8D8] border-t border-[#E5DCC8] py-12 px-6 mt-auto">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h4 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wider">Product</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><Link href="/storefront" className="hover:text-gray-900 transition-colors">Registry</Link></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Pricing</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">API Status</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wider">Company</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><a href="#" className="hover:text-gray-900 transition-colors">About</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wider">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><a href="#" className="hover:text-gray-900 transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Security</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">BAA</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wider">About</h4>
              <p className="text-sm text-gray-600">
                An infrastructure project by{" "}
                <a
                  href="https://tmrwgroup.ai"
                  className="text-black font-semibold underline hover:no-underline"
                >
                  Tmrwgroup
                </a>
              </p>
            </div>
          </div>

          <div className="border-t border-[#E5DCC8] pt-6 flex flex-col md:flex-row justify-between items-center">
            <div className="text-sm text-gray-500 mb-4 md:mb-0">
              &copy; 2026 Tmrwgroup. All rights reserved.
            </div>
            <div className="text-xl font-bold serif italic">
              bkstr
              <span
                className="text-gray-400 font-normal text-sm not-italic"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                .tmrwgroup.ai
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
