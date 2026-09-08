import type { ComponentType } from "react";
import type { SpecialRecorderId } from "@capture/recorder-kit";

export type CapturePageProps = {
  requestModeChange: (delta: -1 | 1) => void;
};

export type CapturePageDefinition = {
  id: SpecialRecorderId;
  Component: ComponentType<CapturePageProps>;
};
