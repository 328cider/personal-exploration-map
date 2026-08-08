export interface FieldTestEnvironmentSnapshot {
  readonly capturedAtMs: number;
  readonly elapsedRealtimeMs: number;
  readonly manufacturer: string;
  readonly brand: string;
  readonly model: string;
  readonly device: string;
  readonly product: string;
  readonly androidVersion: string;
  readonly sdkInt: number;
  readonly buildId: string;
  readonly buildFingerprintHash: string;
  readonly packageName: string;
  readonly appVersionName: string | null;
  readonly appVersionCode: number;
  readonly isDebuggable: boolean;
  readonly timezoneId: string;
  readonly timezoneOffsetMinutes: number;
  readonly localeTag: string;
  readonly batteryLevelPercent: number | null;
  readonly batteryStatus: string;
  readonly batteryPlugged: string;
  readonly batteryTemperatureCelsius: number | null;
  readonly batteryVoltageMillivolts: number | null;
  readonly batteryCurrentMicroamps: number | null;
  readonly batteryChargeCounterMicroampHours: number | null;
  readonly powerSaveMode: boolean;
  readonly batteryOptimizationEnabled: boolean | null;
  readonly thermalStatus: number | null;
  readonly fineLocationGranted: boolean;
  readonly coarseLocationGranted: boolean;
  readonly backgroundLocationGranted: boolean;
  readonly notificationGranted: boolean;
}

export interface FieldTestDiagnosticsNativeModule {
  captureEnvironmentSnapshotAsync(): Promise<FieldTestEnvironmentSnapshot>;
}
