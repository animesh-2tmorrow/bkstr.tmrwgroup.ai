import Link from "next/link";

export const metadata = {
  title: "Sign up | bkstr",
};

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#FAF6EC] rounded-2xl shadow-sm border border-[#E5DCC8] p-8">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold serif italic mb-2">bkstr</div>
          <h1 className="text-xl font-bold">Create your workspace</h1>
          <p className="text-sm text-gray-500 mt-1">Start your 14-day free trial</p>
        </div>

        <form className="space-y-5" action="/dashboard">
          <div>
            <label htmlFor="company" className="block text-sm font-semibold text-gray-700 mb-1">
              Company Name
            </label>
            <input
              type="text"
              id="company"
              className="input-field w-full p-3 rounded-lg text-sm bg-[#FAF6EC]"
              placeholder="Acme Corp"
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1">
              Work Email
            </label>
            <input
              type="email"
              id="email"
              className="input-field w-full p-3 rounded-lg text-sm bg-[#FAF6EC]"
              placeholder="admin@company.com"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              id="password"
              className="input-field w-full p-3 rounded-lg text-sm bg-[#FAF6EC]"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-black text-[#FAF6EC] font-bold p-3 rounded-lg hover:bg-black transition-colors shadow-sm mt-2"
          >
            Create Account
          </button>
        </form>

        <div className="mt-6 relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#E5DCC8]"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-[#FAF6EC] text-gray-500">Or sign up with</span>
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            className="w-full bg-[#FAF6EC] border border-[#E5DCC8] text-gray-700 font-semibold p-3 rounded-lg hover:bg-[#EAE2D0] transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Google
          </button>
        </div>

        <div className="mt-8 text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="text-black font-semibold underline hover:no-underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
