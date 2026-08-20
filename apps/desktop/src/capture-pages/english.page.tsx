import type { CapturePageDefinition, CapturePageProps } from "./types";

function EnglishPage({ requestModeChange }: CapturePageProps) {
  return (
    <main
      className="captureExtensionPage viewEnter"
      aria-label="英文紀錄（尚未實作）"
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
  id: "english",
  order: 10,
  Component: EnglishPage,
} satisfies CapturePageDefinition;
