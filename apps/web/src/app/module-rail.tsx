"use client";

import { RECORDER_CATALOG, type RecorderId } from "@capture/recorder-kit";

export type CaptureModule = RecorderId;

export function ModuleRail({
  active,
  onSelect,
}: {
  active: CaptureModule;
  onSelect(module: CaptureModule): void;
}) {
  return (
    <nav className="moduleRail" aria-label="紀錄類型">
      {RECORDER_CATALOG.map((module) => (
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
