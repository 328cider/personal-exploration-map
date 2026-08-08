import { requireOptionalNativeModule } from "expo-modules-core";

import type {
  FieldTestDiagnosticsNativeModule,
  FieldTestEnvironmentSnapshot,
} from "./FieldTestDiagnostics.types";

const nativeModule =
  requireOptionalNativeModule<FieldTestDiagnosticsNativeModule>(
    "FieldTestDiagnostics",
  );

export async function captureFieldTestEnvironmentSnapshot(): Promise<FieldTestEnvironmentSnapshot | null> {
  if (nativeModule === null) {
    return null;
  }
  return nativeModule.captureEnvironmentSnapshotAsync();
}

export async function writeFieldTestTextFile(
  fileName: string,
  content: string,
): Promise<string | null> {
  if (nativeModule === null) {
    return null;
  }
  return nativeModule.writeFieldTestTextFileAsync(fileName, content);
}
