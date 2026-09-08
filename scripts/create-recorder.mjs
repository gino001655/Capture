import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CATALOG_MARKER = "  // recorder-catalog-entry";
const IMPORT_MARKER = "// recorder-import";
const WRAPPER_MARKER = "// recorder-wrapper";
const ENTRY_MARKER = "  // recorder-entry";

function componentName(id) {
  return id
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join("");
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function insertBefore(source, marker, value, file) {
  if (!source.includes(marker)) {
    throw new Error(`Missing generator marker in ${file}: ${marker.trim()}`);
  }
  return source.replace(marker, `${value}\n${marker}`);
}

function webStarter(id, label, name) {
  const labelLiteral = JSON.stringify(label);
  return `"use client";

import type { RecorderId } from "@capture/recorder-kit";
import { ModuleRail } from "./module-rail";

export function ${name}App({
  active,
  onSelectModule,
}: {
  active: boolean;
  onSelectModule(module: RecorderId): void;
}) {
  if (!active) return null;

  return (
    <main className="captureExtensionPage recorderStarterPage" aria-label={${labelLiteral}}>
      <ModuleRail active="${id}" onSelect={onSelectModule} />
      <section>
        <textarea aria-label={${JSON.stringify(`${label}內容`)}} autoFocus placeholder={${labelLiteral}} />
      </section>
    </main>
  );
}
`;
}

function desktopStarter(id, label, name) {
  const labelLiteral = JSON.stringify(label);
  return `import type { KeyboardEvent } from "react";

import type { CapturePageDefinition, CapturePageProps } from "./types";

function ${name}Page({ requestModeChange }: CapturePageProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!event.ctrlKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    requestModeChange(event.key === "ArrowLeft" ? -1 : 1);
  }

  return (
    <main
      className="captureExtensionPage recorderStarterPage viewEnter"
      aria-label={${labelLiteral}}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <textarea aria-label={${JSON.stringify(`${label}內容`)}} autoFocus placeholder={${labelLiteral}} />
    </main>
  );
}

export default {
  id: "${id}",
  Component: ${name}Page,
} satisfies CapturePageDefinition;
`;
}

export async function createRecorder(input, root = process.cwd()) {
  const id = input.id?.trim();
  const label = input.label?.trim();
  const symbol = input.symbol?.trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id ?? "")) {
    throw new Error("Recorder id must be lowercase kebab-case.");
  }
  if (!label) throw new Error("Recorder label is required.");
  if (!symbol || symbol.length > 4) {
    throw new Error("Recorder symbol must contain 1 to 4 characters.");
  }

  const catalogPath = path.join(root, "packages/recorder-kit/src/index.ts");
  const registryPath = path.join(root, "apps/web/src/app/recorder-registry.tsx");
  const webPath = path.join(root, `apps/web/src/app/${id}-app.tsx`);
  const desktopPath = path.join(
    root,
    `apps/desktop/src/capture-pages/${id}.page.tsx`,
  );
  const [catalog, registry] = await Promise.all([
    readFile(catalogPath, "utf8"),
    readFile(registryPath, "utf8"),
  ]);
  if (catalog.includes(`id: "${id}"`) || (await exists(webPath)) || (await exists(desktopPath))) {
    throw new Error(`Recorder "${id}" already exists.`);
  }

  for (const [source, marker, file] of [
    [catalog, CATALOG_MARKER, catalogPath],
    [registry, IMPORT_MARKER, registryPath],
    [registry, WRAPPER_MARKER, registryPath],
    [registry, ENTRY_MARKER, registryPath],
  ]) {
    if (!source.includes(marker)) {
      throw new Error(`Missing generator marker in ${file}: ${marker.trim()}`);
    }
  }

  const orders = [...catalog.matchAll(/order:\s*(\d+)/g)].map((match) => Number(match[1]));
  const order = Math.ceil((Math.max(...orders, 0) + 1) / 10) * 10;
  const name = componentName(id);
  const nextCatalog = insertBefore(
    catalog,
    CATALOG_MARKER,
    `  { id: "${id}", order: ${order}, label: ${JSON.stringify(label)}, symbol: ${JSON.stringify(symbol)}, kind: "special" },`,
    catalogPath,
  );
  let nextRegistry = insertBefore(
    registry,
    IMPORT_MARKER,
    `import { ${name}App } from "./${id}-app";`,
    registryPath,
  );
  nextRegistry = insertBefore(
    nextRegistry,
    WRAPPER_MARKER,
    `function ${name}Recorder({ active, onSelectModule }: WebRecorderProps) {\n  return <${name}App active={active} onSelectModule={onSelectModule} />;\n}`,
    registryPath,
  );
  nextRegistry = insertBefore(
    nextRegistry,
    ENTRY_MARKER,
    `  ${JSON.stringify(id)}: ${name}Recorder,`,
    registryPath,
  );

  await Promise.all([
    mkdir(path.dirname(webPath), { recursive: true }),
    mkdir(path.dirname(desktopPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(webPath, webStarter(id, label, name), { flag: "wx" }),
    writeFile(desktopPath, desktopStarter(id, label, name), { flag: "wx" }),
  ]);
  await Promise.all([
    writeFile(catalogPath, nextCatalog),
    writeFile(registryPath, nextRegistry),
  ]);

  return [
    path.relative(root, webPath).replaceAll("\\", "/"),
    path.relative(root, desktopPath).replaceAll("\\", "/"),
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id, label, symbol] = process.argv.slice(2);
  try {
    const files = await createRecorder({ id, label, symbol });
    console.log(`Created recorder "${id}":`);
    for (const file of files) console.log(`- ${file}`);
    console.log("Next: replace the starter textareas and add a versioned data contract if the recorder syncs.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
