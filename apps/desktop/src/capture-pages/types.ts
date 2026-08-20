import type { ComponentType } from "react";

export type CapturePageProps = {
  requestModeChange: (delta: -1 | 1) => void;
};

export type CapturePageDefinition = {
  id: string;
  order: number;
  Component: ComponentType<CapturePageProps>;
};
