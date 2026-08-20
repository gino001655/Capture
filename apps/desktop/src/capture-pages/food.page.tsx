import type { CapturePageDefinition, CapturePageProps } from "./types";

function FoodPage({ requestModeChange }: CapturePageProps) {
  return (
    <main
      className="captureExtensionPage viewEnter"
      aria-label="飲食紀錄（尚未實作）"
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
  id: "food",
  order: 30,
  Component: FoodPage,
} satisfies CapturePageDefinition;
