import type { ComponentType } from "react";
import type { RecorderId } from "@capture/recorder-kit";

import { EnglishApp } from "./english-app";
import { JournalApp } from "./journal-app";
import { WorkoutApp } from "./workout-app";
import { FoodApp } from "./food-app";

export type WebRecorderProps = {
  accountEmail: string;
  active: boolean;
  onSelectModule(module: RecorderId): void;
};

function JournalRecorder({ accountEmail, active, onSelectModule }: WebRecorderProps) {
  return (
    <JournalApp
      accountEmail={accountEmail}
      active={active}
      onSelectModule={onSelectModule}
    />
  );
}

function EnglishRecorder({ active, onSelectModule }: WebRecorderProps) {
  return <EnglishApp active={active} onSelectModule={onSelectModule} />;
}

function WorkoutRecorder({ active, onSelectModule }: WebRecorderProps) {
  return <WorkoutApp active={active} onSelectModule={onSelectModule} />;
}

function FoodRecorder({ active, onSelectModule }: WebRecorderProps) {
  return <FoodApp active={active} onSelectModule={onSelectModule} />;
}

/**
 * Web pages are explicit because Next.js does not provide Vite's import.meta.glob.
 * Adding a recorder means adding one component and one entry here; TypeScript
 * rejects a catalog entry that has no Web implementation.
 */
export const WEB_RECORDER_PAGES = {
  journal: JournalRecorder,
  english: EnglishRecorder,
  workout: WorkoutRecorder,
  food: FoodRecorder,
} satisfies Record<RecorderId, ComponentType<WebRecorderProps>>;
