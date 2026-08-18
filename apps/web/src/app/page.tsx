import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeWebHeaders } from "../lib/authorization";
import { JournalApp } from "./journal-app";

export default async function Home() {
  const authorization = await authorizeWebHeaders(await headers());

  if (authorization.status !== "authorized" || !authorization.email) {
    redirect("/sign-in");
  }

  return <JournalApp accountEmail={authorization.email} />;
}
