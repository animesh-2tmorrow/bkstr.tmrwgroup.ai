import Link from "next/link";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export const metadata = {
  title: "Log in | bkstr",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#FAF6EC] rounded-2xl shadow-sm border border-[#E5DCC8] p-8">
        <div className="text-center mb-8">
          <div className="text-2xl font-bold serif italic mb-2">bkstr</div>
          <h1 className="text-xl font-bold">Welcome back</h1>
          <p className="text-sm text-gray-500 mt-1">Log in to manage your agent fleet</p>
        </div>

        <GoogleSignInButton label="Continue with Google" />

        <p className="mt-4 text-xs text-gray-500 text-center">
          Email and password sign-in coming soon—use Google for now
        </p>

        <div className="mt-8 text-center text-sm text-gray-600">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-black font-semibold underline hover:no-underline">
            Start a trial
          </Link>
        </div>
      </div>
    </div>
  );
}
