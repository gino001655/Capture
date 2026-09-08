import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createRecorder } from "./create-recorder.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "capture-recorder-"));
  await mkdir(path.join(root, "packages/recorder-kit/src"), { recursive: true });
  await mkdir(path.join(root, "apps/web/src/app"), { recursive: true });
  await mkdir(path.join(root, "apps/desktop/src/capture-pages"), { recursive: true });
  await writeFile(
    path.join(root, "packages/recorder-kit/src/index.ts"),
    `export const RECORDER_CATALOG = [\n  { id: "journal", order: 0, label: "Journal", symbol: "○", kind: "core" },\n  // recorder-catalog-entry\n] as const;\n`,
  );
  await writeFile(
    path.join(root, "apps/web/src/app/recorder-registry.tsx"),
    `import { JournalApp } from "./journal-app";\n// recorder-import\n\nfunction JournalRecorder() { return <JournalApp />; }\n// recorder-wrapper\n\nexport const WEB_RECORDER_PAGES = {\n  journal: JournalRecorder,\n  // recorder-entry\n};\n`,
  );
  return root;
}

test("createRecorder adds catalog, Web, and Desktop starter files", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const files = await createRecorder(
    { id: "reading", label: "閱讀", symbol: "R" },
    root,
  );

  assert.deepEqual(files.sort(), [
    "apps/desktop/src/capture-pages/reading.page.tsx",
    "apps/web/src/app/reading-app.tsx",
  ]);
  assert.match(
    await readFile(path.join(root, "packages/recorder-kit/src/index.ts"), "utf8"),
    /id: "reading", order: 10, label: "閱讀", symbol: "R"/,
  );
  const registry = await readFile(
    path.join(root, "apps/web/src/app/recorder-registry.tsx"),
    "utf8",
  );
  assert.match(registry, /import \{ ReadingApp \} from "\.\/reading-app";/);
  assert.match(registry, /"reading": ReadingRecorder,/);
  assert.match(
    await readFile(path.join(root, "apps/web/src/app/reading-app.tsx"), "utf8"),
    /export function ReadingApp/,
  );
  assert.match(
    await readFile(
      path.join(root, "apps/desktop/src/capture-pages/reading.page.tsx"),
      "utf8",
    ),
    /id: "reading"/,
  );
});

test("createRecorder refuses duplicate ids without overwriting files", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { id: "reading", label: "閱讀", symbol: "R" };

  await createRecorder(input, root);
  await assert.rejects(createRecorder(input, root), /already exists/);
});

test("createRecorder rejects ids that are unsafe as file names", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    createRecorder({ id: "../bad", label: "Bad", symbol: "!" }, root),
    /lowercase kebab-case/,
  );
});
