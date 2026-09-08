"use client";

import { useState } from "react";

import { RECORDER_CATALOG, type RecorderId } from "@capture/recorder-kit";
import { WEB_RECORDER_PAGES } from "./recorder-registry";

export function CaptureApp({ accountEmail }: { accountEmail: string }) {
  const [module, setModule] = useState<RecorderId>("journal");

  return (
    <div className="captureApp">
      {RECORDER_CATALOG.map(({ id }) => {
        const Recorder = WEB_RECORDER_PAGES[id];
        return (
          <Recorder
            key={id}
            accountEmail={accountEmail}
            active={module === id}
            onSelectModule={setModule}
          />
        );
      })}
    </div>
  );
}
