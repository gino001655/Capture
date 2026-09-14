type DirectionalKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

type DirectionalFocusEvent = {
  key: string;
  target: EventTarget | null;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
};

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "summary",
  "[tabindex='0']",
].join(",");

export function nextDirectionalFocusIndex(
  currentIndex: number,
  count: number,
  key: DirectionalKey,
): number {
  if (count <= 0) return -1;
  const delta = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
  return Math.max(0, Math.min(count - 1, currentIndex + delta));
}

function textareaKeepsArrow(target: HTMLTextAreaElement, key: DirectionalKey): boolean {
  if (key === "ArrowLeft" || key === "ArrowRight") return true;
  if (key === "ArrowUp") return target.selectionStart !== 0 || target.selectionEnd !== 0;
  return target.selectionStart !== target.value.length || target.selectionEnd !== target.value.length;
}

export function handleDirectionalFocus(
  event: DirectionalFocusEvent,
  root: HTMLElement,
): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return false;
  const key = event.key as DirectionalKey;
  const rawTarget = event.target;
  if (!(rawTarget instanceof HTMLElement)) return false;
  if (rawTarget.isContentEditable) return false;
  if (rawTarget instanceof HTMLTextAreaElement && textareaKeepsArrow(rawTarget, key)) return false;
  if ((rawTarget instanceof HTMLInputElement || rawTarget instanceof HTMLSelectElement) && (key === "ArrowLeft" || key === "ArrowRight")) return false;

  const controls = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => (
    element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true"
  ));
  const current = rawTarget.closest<HTMLElement>(FOCUSABLE_SELECTOR);
  const currentIndex = current ? controls.indexOf(current) : -1;
  const nextIndex = currentIndex < 0
    ? (key === "ArrowDown" || key === "ArrowRight" ? 0 : controls.length - 1)
    : nextDirectionalFocusIndex(currentIndex, controls.length, key);
  const next = controls[nextIndex];
  if (!next || next === current) return false;
  event.preventDefault();
  next.focus();
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}
