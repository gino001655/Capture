import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeWebHeaders } from "../../lib/authorization";
import { SignInButton } from "./sign-in-button";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const authorization = await authorizeWebHeaders(await headers());

  if (authorization.status === "authorized") {
    redirect("/");
  }

  return (
    <main className="singlePanelPage">
      <section className="capturePanel authPanel">
        <p className="eyebrow">Personal Capture System</p>
        <h1>Sign in.</h1>
        {authorization.status === "misconfigured" ? (
          <div className="result errorResult" role="alert">
            <strong>Authentication setup is incomplete</strong>
            <p>Missing: {authorization.missing.join(", ")}</p>
          </div>
        ) : (
          <>
            <p className="summary">
              Continue with the one Google account allowed to use this system.
            </p>
            <SignInButton />
          </>
        )}
      </section>
    </main>
  );
}
