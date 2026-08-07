import { readFile, writeFile } from "node:fs/promises";

if (process.env.EXPO_PUBLIC_FIELD_TEST !== "1") {
  throw new Error(
    "Refusing to prepare field-test sources without EXPO_PUBLIC_FIELD_TEST=1.",
  );
}

const replacements = [
  {
    path: "apps/mobile/App.tsx",
    before:
      "        __DEV__\n          ? loadPersonalMapTrackingDiagnostics(personalMapId)",
    after:
      "        true\n          ? loadPersonalMapTrackingDiagnostics(personalMapId)",
  },
  {
    path: "apps/mobile/src/screens/ReviewScreen.tsx",
    before:
      "      {__DEV__ ? <TrackingDiagnosticsPanel reports={diagnostics} /> : null}",
    after: "      <TrackingDiagnosticsPanel reports={diagnostics} />",
  },
];

for (const replacement of replacements) {
  const current = await readFile(replacement.path, "utf8");
  const occurrences = current.split(replacement.before).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${replacement.path}: expected exactly one diagnostics gate, found ${occurrences}.`,
    );
  }
  await writeFile(
    replacement.path,
    current.replace(replacement.before, replacement.after),
    "utf8",
  );
}

console.log("Prepared coordinate-free diagnostics for the field-test build.");
