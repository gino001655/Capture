type BrowserEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export type JournalBrowserEventOptions = {
  onlineTarget: BrowserEventTarget;
  visibilityTarget: BrowserEventTarget & { visibilityState: string };
  onOnline(): void;
  onHidden(): void;
  onVisible(): void;
};

export function attachJournalBrowserEvents({
  onlineTarget,
  visibilityTarget,
  onOnline,
  onHidden,
  onVisible,
}: JournalBrowserEventOptions): () => void {
  const handleOnline: EventListener = () => onOnline();
  const handleVisibilityChange: EventListener = () => {
    if (visibilityTarget.visibilityState === "hidden") {
      onHidden();
      return;
    }
    onVisible();
  };

  onlineTarget.addEventListener("online", handleOnline);
  visibilityTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    onlineTarget.removeEventListener("online", handleOnline);
    visibilityTarget.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
