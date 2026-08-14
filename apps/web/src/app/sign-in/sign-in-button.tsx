"use client";

import { useState } from "react";

import { authClient } from "../../lib/auth-client";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
    });
  }

  return (
    <button type="button" onClick={signIn} disabled={pending}>
      {pending ? "Opening Google..." : "Continue with Google"}
    </button>
  );
}
