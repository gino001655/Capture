import { betterAuth } from "better-auth";

export const WEB_AUTH_ENVIRONMENT_VARIABLES = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTHORIZED_EMAIL",
] as const;

type WebAuthEnvironmentVariable =
  (typeof WEB_AUTH_ENVIRONMENT_VARIABLES)[number];

function readEnvironmentVariable(name: WebAuthEnvironmentVariable) {
  return process.env[name]?.trim() ?? "";
}

export function getMissingWebAuthConfiguration() {
  return WEB_AUTH_ENVIRONMENT_VARIABLES.filter((name) => {
    const value = readEnvironmentVariable(name);
    return value.length === 0 || (name === "BETTER_AUTH_SECRET" && value.length < 32);
  });
}

function requireEnvironmentVariable(name: WebAuthEnvironmentVariable) {
  const value = readEnvironmentVariable(name);

  if (!value) {
    throw new Error(`${name} must be set in the server environment.`);
  }

  return value;
}

function createAuth() {
  return betterAuth({
    appName: "Personal Capture System",
    baseURL: requireEnvironmentVariable("BETTER_AUTH_URL"),
    secret: requireEnvironmentVariable("BETTER_AUTH_SECRET"),
    socialProviders: {
      google: {
        clientId: requireEnvironmentVariable("GOOGLE_CLIENT_ID"),
        clientSecret: requireEnvironmentVariable("GOOGLE_CLIENT_SECRET"),
        prompt: "select_account",
      },
    },
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  authInstance ??= createAuth();
  return authInstance;
}
