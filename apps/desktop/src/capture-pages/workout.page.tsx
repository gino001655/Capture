import type { CapturePageDefinition, CapturePageProps } from "./types";

function WorkoutPage({ requestModeChange }: CapturePageProps) {
  return (
    <main
      className="captureExtensionPage viewEnter"
      aria-label="重訓紀錄（尚未實作）"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.ctrlKey && event.key === "ArrowLeft") {
          event.preventDefault();
          requestModeChange(-1);
        }
        if (event.ctrlKey && event.key === "ArrowRight") {
          event.preventDefault();
          requestModeChange(1);
        }
      }}
    />
  );
}

export default {
  id: "workout",
  Component: WorkoutPage,
} satisfies CapturePageDefinition;
