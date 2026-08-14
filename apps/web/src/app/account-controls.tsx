"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "../lib/auth-client";

export function AccountControls({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="accountControls">
      <span>{email}</span>
      <button type="button" onClick={signOut} disabled={pending}>
        {pending ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
