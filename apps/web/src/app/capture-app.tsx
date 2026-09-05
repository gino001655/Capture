"use client";

import { useState } from "react";

import { EnglishApp } from "./english-app";
import { JournalApp } from "./journal-app";
import { ModuleRail, type CaptureModule } from "./module-rail";

export function CaptureApp({ accountEmail }: { accountEmail: string }) {
  const [module, setModule] = useState<CaptureModule>("journal");

  return (
    <div className="captureApp">
      <JournalApp
        accountEmail={accountEmail}
        active={module === "journal"}
        onSelectModule={setModule}
      />
      <EnglishApp active={module === "english"} onSelectModule={setModule} />
      {module === "workout" || module === "food" ? (
        <main className="specialPlaceholder">
          <ModuleRail active={module} onSelect={setModule} />
        </main>
      ) : null}
    </div>
  );
}
