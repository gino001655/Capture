import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authorizeWebHeaders } from "../lib/authorization";
import { CaptureApp } from "./capture-app";

export default async function Home() {
  const authorization = await authorizeWebHeaders(await headers());

  if (authorization.status !== "authorized" || !authorization.email) {
    redirect("/sign-in");
  }

  return <CaptureApp accountEmail={authorization.email} />;
}
