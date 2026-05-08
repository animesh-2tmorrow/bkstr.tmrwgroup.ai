"use client";

import { signOut } from "next-auth/react";

export function SignOutLink() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="text-sm text-gray-500 hover:text-gray-900 font-medium text-left"
    >
      Log out
    </button>
  );
}
