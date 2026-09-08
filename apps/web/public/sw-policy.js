(function attachCaptureOfflinePolicy(global) {
  const STATIC_PATHS = new Set([
    "/capture-logo.png",
    "/manifest.webmanifest",
  ]);

  function classifyRequest(input) {
    if (input.method !== "GET" || input.origin !== input.appOrigin) {
      return "network";
    }

    if (
      input.pathname.startsWith("/api/") ||
      input.pathname.startsWith("/sign-in") ||
      input.pathname === "/sw.js" ||
      input.pathname === "/sw-policy.js"
    ) {
      return "network";
    }

    if (input.mode === "navigate") {
      return input.pathname === "/" ? "navigation" : "network";
    }

    if (
      input.pathname.startsWith("/_next/static/") ||
      STATIC_PATHS.has(input.pathname)
    ) {
      return "static";
    }

    return "network";
  }

  global.CaptureOfflinePolicy = { classifyRequest };
})(globalThis);
