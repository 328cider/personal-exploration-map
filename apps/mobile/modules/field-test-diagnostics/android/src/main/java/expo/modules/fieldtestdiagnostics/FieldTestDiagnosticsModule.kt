package expo.modules.fieldtestdiagnostics

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.util.Locale
import java.util.TimeZone

class FieldTestDiagnosticsModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("FieldTestDiagnostics")

    AsyncFunction("captureEnvironmentSnapshotAsync") {
      captureEnvironmentSnapshot(context)
    }
  }
}

private fun captureEnvironmentSnapshot(context: Context): Map<String, Any?> {
  val capturedAtMs = System.currentTimeMillis()
  val packageManager = context.packageManager
  val packageName = context.packageName
  val packageInfo = packageInfo(packageManager, packageName)
  val batteryIntent = context.registerReceiver(
    null,
    IntentFilter(Intent.ACTION_BATTERY_CHANGED),
  )
  val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
  val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
  val timeZone = TimeZone.getDefault()

  val batteryLevel = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
  val batteryScale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
  val batteryPercent = if (batteryLevel >= 0 && batteryScale > 0) {
    batteryLevel * 100.0 / batteryScale
  } else {
    null
  }

  val batteryTemperatureTenthsCelsius = batteryIntent?.getIntExtra(
    BatteryManager.EXTRA_TEMPERATURE,
    Int.MIN_VALUE,
  ) ?: Int.MIN_VALUE
  val batteryVoltageMillivolts = batteryIntent?.getIntExtra(
    BatteryManager.EXTRA_VOLTAGE,
    Int.MIN_VALUE,
  ) ?: Int.MIN_VALUE
  val batteryStatus = batteryIntent?.getIntExtra(
    BatteryManager.EXTRA_STATUS,
    BatteryManager.BATTERY_STATUS_UNKNOWN,
  ) ?: BatteryManager.BATTERY_STATUS_UNKNOWN
  val batteryPlugged = batteryIntent?.getIntExtra(
    BatteryManager.EXTRA_PLUGGED,
    0,
  ) ?: 0

  return mapOf(
    "capturedAtMs" to capturedAtMs.toDouble(),
    "elapsedRealtimeMs" to SystemClock.elapsedRealtime().toDouble(),
    "manufacturer" to Build.MANUFACTURER,
    "brand" to Build.BRAND,
    "model" to Build.MODEL,
    "device" to Build.DEVICE,
    "product" to Build.PRODUCT,
    "androidVersion" to Build.VERSION.RELEASE,
    "sdkInt" to Build.VERSION.SDK_INT,
    "buildId" to Build.ID,
    "buildFingerprintHash" to sha256(Build.FINGERPRINT),
    "packageName" to packageName,
    "appVersionName" to packageInfo.versionName,
    "appVersionCode" to packageVersionCode(packageInfo).toDouble(),
    "isDebuggable" to ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0),
    "timezoneId" to timeZone.id,
    "timezoneOffsetMinutes" to timeZone.getOffset(capturedAtMs) / 60_000,
    "localeTag" to Locale.getDefault().toLanguageTag(),
    "batteryLevelPercent" to batteryPercent,
    "batteryStatus" to batteryStatusLabel(batteryStatus),
    "batteryPlugged" to batteryPluggedLabel(batteryPlugged),
    "batteryTemperatureCelsius" to if (batteryTemperatureTenthsCelsius == Int.MIN_VALUE) {
      null
    } else {
      batteryTemperatureTenthsCelsius / 10.0
    },
    "batteryVoltageMillivolts" to batteryVoltageMillivolts.takeUnless { it == Int.MIN_VALUE },
    "batteryCurrentMicroamps" to batteryProperty(
      batteryManager,
      BatteryManager.BATTERY_PROPERTY_CURRENT_NOW,
    ),
    "batteryChargeCounterMicroampHours" to batteryProperty(
      batteryManager,
      BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER,
    ),
    "powerSaveMode" to (powerManager?.isPowerSaveMode ?: false),
    "batteryOptimizationEnabled" to (
      powerManager?.isIgnoringBatteryOptimizations(packageName)?.not()
    ),
    "thermalStatus" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      powerManager?.currentThermalStatus
    } else {
      null
    },
    "fineLocationGranted" to permissionGranted(
      context,
      Manifest.permission.ACCESS_FINE_LOCATION,
    ),
    "coarseLocationGranted" to permissionGranted(
      context,
      Manifest.permission.ACCESS_COARSE_LOCATION,
    ),
    "backgroundLocationGranted" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      permissionGranted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    } else {
      true
    },
    "notificationGranted" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      permissionGranted(context, Manifest.permission.POST_NOTIFICATIONS)
    } else {
      true
    },
  )
}

@Suppress("DEPRECATION")
private fun packageInfo(
  packageManager: PackageManager,
  packageName: String,
): PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
  packageManager.getPackageInfo(
    packageName,
    PackageManager.PackageInfoFlags.of(0),
  )
} else {
  packageManager.getPackageInfo(packageName, 0)
}

@Suppress("DEPRECATION")
private fun packageVersionCode(packageInfo: PackageInfo): Long =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    packageInfo.longVersionCode
  } else {
    packageInfo.versionCode.toLong()
  }

private fun permissionGranted(context: Context, permission: String): Boolean =
  context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

private fun batteryProperty(
  batteryManager: BatteryManager?,
  property: Int,
): Int? {
  val value = batteryManager?.getIntProperty(property) ?: return null
  return value.takeUnless { it == Int.MIN_VALUE }
}

private fun batteryStatusLabel(status: Int): String = when (status) {
  BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
  BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
  BatteryManager.BATTERY_STATUS_FULL -> "full"
  BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
  else -> "unknown"
}

private fun batteryPluggedLabel(plugged: Int): String = when (plugged) {
  BatteryManager.BATTERY_PLUGGED_AC -> "ac"
  BatteryManager.BATTERY_PLUGGED_USB -> "usb"
  BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
  else -> "none"
}

private fun sha256(value: String): String = MessageDigest
  .getInstance("SHA-256")
  .digest(value.toByteArray(Charsets.UTF_8))
  .joinToString(separator = "") { byte -> "%02x".format(byte) }
