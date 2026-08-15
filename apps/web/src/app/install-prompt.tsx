"use client";

import { useSyncExternalStore } from "react";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function subscribeToDisplayMode(onChange: () => void) {
  const mediaQuery = window.matchMedia("(display-mode: standalone)");
  mediaQuery.addEventListener("change", onChange);

  return () => mediaQuery.removeEventListener("change", onChange);
}

function shouldOfferInstallation() {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true;

  return isIOS && !isStandalone;
}

export function InstallPrompt() {
  const shouldShow = useSyncExternalStore(
    subscribeToDisplayMode,
    shouldOfferInstallation,
    () => false,
  );

  if (!shouldShow) {
    return null;
  }

  return (
    <aside className="installPrompt" aria-label="Install on iPhone">
      <strong>Keep Capture on your Home Screen</strong>
      <span>In Safari: Share → Add to Home Screen → Open as Web App.</span>
    </aside>
  );
}
