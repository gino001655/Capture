import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeWebHeaders } from "../lib/authorization";
import { AccountControls } from "./account-controls";
import { CaptureForm } from "./capture-form";

export default async function Home() {
  const authorization = await authorizeWebHeaders(await headers());

  if (authorization.status !== "authorized" || !authorization.email) {
    redirect("/sign-in");
  }

  return (
    <main>
      <section className="intro">
        <p className="eyebrow">Personal Capture System</p>
        <h1>Get it out of your head.</h1>
        <p className="summary">
          Capture one piece of content, persist it in Atlas, and let your
          Desktop worker process it.
        </p>
        <div className="status" aria-label="Current project status">
          <span className="statusDot" aria-hidden="true" />
          Local Web + API + Desktop
        </div>
        <AccountControls email={authorization.email} />
      </section>
      <CaptureForm />
    </main>
  );
}
