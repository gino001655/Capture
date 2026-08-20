import type { CapturePageDefinition } from "./types";

const modules = import.meta.glob<{ default: CapturePageDefinition }>(
  "./*.page.tsx",
  { eager: true },
);

export const SPECIAL_CAPTURE_PAGES = Object.values(modules)
  .map((module) => module.default)
  .sort((left, right) => left.order - right.order);
