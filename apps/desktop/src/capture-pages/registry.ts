import type { CapturePageDefinition } from "./types";
import { recorderDefinition } from "@capture/recorder-kit";

const modules = import.meta.glob<{ default: CapturePageDefinition }>(
  "./*.page.tsx",
  { eager: true },
);

export const SPECIAL_CAPTURE_PAGES = Object.values(modules)
  .map((module) => module.default)
  .sort((left, right) =>
    recorderDefinition(left.id).order - recorderDefinition(right.id).order
  );
