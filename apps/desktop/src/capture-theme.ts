export type CaptureTheme = { paper: string; ink: string };

export const CAPTURE_THEME_STORAGE_KEY = "capture.desktop.theme.v1";
export const DEFAULT_CAPTURE_THEME: CaptureTheme = {
  paper: "#ffffff",
  ink: "#080808",
};

const COLOR = /^#[0-9a-f]{6}$/i;

export function readCaptureTheme(): CaptureTheme {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(CAPTURE_THEME_STORAGE_KEY) ?? "null",
    );
    if (
      typeof value === "object" &&
      value !== null &&
      "paper" in value &&
      "ink" in value &&
      typeof value.paper === "string" &&
      typeof value.ink === "string" &&
      COLOR.test(value.paper) &&
      COLOR.test(value.ink)
    ) {
      return { paper: value.paper, ink: value.ink };
    }
  } catch {
    // Use the stable monochrome default.
  }
  return DEFAULT_CAPTURE_THEME;
}

export function writeCaptureTheme(theme: CaptureTheme) {
  localStorage.setItem(CAPTURE_THEME_STORAGE_KEY, JSON.stringify(theme));
}
