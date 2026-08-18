import assert from "node:assert/strict";
import test from "node:test";

type AttachBrowserEvents = (options: {
  onlineTarget: EventTarget;
  visibilityTarget: EventTarget & { visibilityState: string };
  onOnline(): void;
  onHidden(): void;
  onVisible(): void;
}) => () => void;

const eventModule = await import("./journal-browser-events.ts").catch(() => ({}));
const attachJournalBrowserEvents = (
  eventModule as { attachJournalBrowserEvents?: AttachBrowserEvents }
).attachJournalBrowserEvents;

class VisibilityTarget extends EventTarget {
  visibilityState = "visible";
}

test("the browser adapter dispatches online and visibility states then removes every listener", () => {
  assert.equal(typeof attachJournalBrowserEvents, "function");
  if (attachJournalBrowserEvents === undefined) return;

  const onlineTarget = new EventTarget();
  const visibilityTarget = new VisibilityTarget();
  const calls: string[] = [];
  const detach = attachJournalBrowserEvents({
    onlineTarget,
    visibilityTarget,
    onOnline: () => calls.push("online"),
    onHidden: () => calls.push("hidden"),
    onVisible: () => calls.push("visible"),
  });

  onlineTarget.dispatchEvent(new Event("online"));
  visibilityTarget.visibilityState = "hidden";
  visibilityTarget.dispatchEvent(new Event("visibilitychange"));
  visibilityTarget.visibilityState = "visible";
  visibilityTarget.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(calls, ["online", "hidden", "visible"]);

  detach();
  onlineTarget.dispatchEvent(new Event("online"));
  visibilityTarget.visibilityState = "hidden";
  visibilityTarget.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual(calls, ["online", "hidden", "visible"]);
});
