"use client";

export type CaptureModule = "journal" | "english" | "workout" | "food";

const MODULES: Array<{ id: CaptureModule; label: string; symbol: string }> = [
  { id: "journal", label: "Journal", symbol: "○" },
  { id: "english", label: "英文", symbol: "Aa" },
  { id: "workout", label: "重訓", symbol: "↟" },
  { id: "food", label: "飲食", symbol: "◫" },
];

export function ModuleRail({
  active,
  onSelect,
}: {
  active: CaptureModule;
  onSelect(module: CaptureModule): void;
}) {
  return (
    <nav className="moduleRail" aria-label="紀錄類型">
      {MODULES.map((module) => (
        <button
          type="button"
          key={module.id}
          aria-label={module.label}
          aria-current={active === module.id ? "page" : undefined}
          onClick={() => onSelect(module.id)}
        >
          <span aria-hidden="true">{module.symbol}</span>
        </button>
      ))}
    </nav>
  );
}
