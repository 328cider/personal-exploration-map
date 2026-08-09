package com.personalexplorationmap.pdrcapture

import android.content.Intent
import android.hardware.Sensor
import org.json.JSONObject

const val SCHEMA_VERSION = "pdr-capture/v1"
const val CAPTURE_ROOT = "pdr-captures"
const val ROTATE_BYTES = 32L * 1024L * 1024L
const val STATE_PREFERENCES = "pdr_capture_state"
const val PREF_ACTIVE_SESSION = "active_session"

object CaptureActions {
    const val START = "com.personalexplorationmap.pdrcapture.START"
    const val STOP = "com.personalexplorationmap.pdrcapture.STOP"
    const val MARK_SYNC = "com.personalexplorationmap.pdrcapture.MARK_SYNC"
    const val ACTIVITY_STATE = "com.personalexplorationmap.pdrcapture.ACTIVITY_STATE"
    const val FINISHED = "com.personalexplorationmap.pdrcapture.FINISHED"
    const val EXTRA_REQUEST = "capture_request"
    const val EXTRA_STATE = "activity_state"
    const val EXTRA_ACTIVITY_SOURCE = "activity_source"
    const val EXTRA_SESSION_ID = "session_id"
    const val EXTRA_BUNDLE_PATH = "bundle_path"
}

enum class LifecycleProtocol(val key: String) {
    FOREGROUND_SCREEN_ON("foreground-screen-on"),
    SCREEN_ON_TO_OFF("foreground-service-screen-on-to-off"),
    SCREEN_OFF("foreground-service-screen-off"),
    APP_BACKGROUND("foreground-service-app-background"),
    NOTIFICATION_RETURN("foreground-service-notification-return");

    companion object {
        fun fromKey(key: String): LifecycleProtocol =
            requireNotNull(entries.firstOrNull { it.key == key }) { "Unknown lifecycle protocol: $key" }
    }
}

enum class MotionCondition(val key: String) {
    NO_WALKING("no-walking"),
    STATIONARY("stationary"),
    WALK("walk"),
    MIXED("mixed");

    companion object {
        fun fromKey(key: String): MotionCondition =
            requireNotNull(entries.firstOrNull { it.key == key }) { "Unknown motion condition: $key" }
    }
}

fun isMotionCaptureAuthorized(condition: MotionCondition): Boolean =
    condition == MotionCondition.NO_WALKING || condition == MotionCondition.STATIONARY

enum class CaptureMode(
    val key: String,
    val targetRateHz: Int,
    val samplingPeriodUs: Int,
    val maxReportLatencyUs: Int,
) {
    LIVE_50("live-50", 50, 20_000, 0),
    LIVE_100("live-100", 100, 10_000, 0),
    BATCH_50_250("batch-50-250", 50, 20_000, 250_000),
    BATCH_100_250("batch-100-250", 100, 10_000, 250_000);

    companion object {
        fun fromKey(key: String): CaptureMode =
            requireNotNull(entries.firstOrNull { it.key == key }) { "Unknown capture mode: $key" }
    }
}

data class CaptureRequest(
    val sessionId: String,
    val programId: String,
    val programRevision: Int,
    val devicePseudonym: String,
    val participantCode: String,
    val placement: String,
    val routeId: String,
    val protocolCellId: String,
    val split: String,
    val lifecycle: LifecycleProtocol,
    val motionCondition: MotionCondition,
    val plannedDurationSeconds: Int,
    val mode: CaptureMode,
    val requestStepSensors: Boolean,
    val requestLocation: Boolean,
    val holdWakeLock: Boolean,
) {
    init {
        require(SAFE_CODE.matches(sessionId)) { "Invalid session ID" }
        require(SAFE_CODE.matches(programId)) { "Invalid program ID" }
        require(programRevision > 0) { "Invalid program revision" }
        require(SAFE_CODE.matches(devicePseudonym)) { "Invalid device pseudonym" }
        require(SAFE_CODE.matches(participantCode)) { "Invalid participant code" }
        require(SAFE_CODE.matches(routeId)) { "Invalid route ID" }
        require(SAFE_CODE.matches(protocolCellId)) { "Invalid protocol cell ID" }
        require(placement in PLACEMENTS) { "Invalid placement" }
        require(split in SPLITS) { "Invalid split" }
        require(plannedDurationSeconds in 60..21_600) { "Invalid planned duration" }
    }

    fun toJson(): JSONObject = JSONObject()
        .put("session_id", sessionId)
        .put("program_id", programId)
        .put("program_revision", programRevision)
        .put("device_pseudonym", devicePseudonym)
        .put("participant_code", participantCode)
        .put("placement", placement)
        .put("route_id", routeId)
        .put("protocol_cell_id", protocolCellId)
        .put("split", split)
        .put("lifecycle", lifecycle.key)
        .put("motion_condition", motionCondition.key)
        .put("planned_duration_s", plannedDurationSeconds)
        .put("mode", mode.key)
        .put("target_rate_hz", mode.targetRateHz)
        .put("sampling_period_us", mode.samplingPeriodUs)
        .put("max_report_latency_us", mode.maxReportLatencyUs)
        .put("request_step_sensors", requestStepSensors)
        .put("request_location", requestLocation)
        .put("hold_wake_lock", holdWakeLock)

    fun putInto(intent: Intent): Intent = intent.putExtra(CaptureActions.EXTRA_REQUEST, toJson().toString())

    companion object {
        private val SAFE_CODE = Regex("[A-Za-z0-9._-]{1,64}")
        private val PLACEMENTS = setOf(
            "front-left", "front-right", "rear-left", "rear-right", "hand", "bag", "other-declared",
        )
        private val SPLITS = setOf("development", "tuning", "sealed-validation")

        fun fromIntent(intent: Intent): CaptureRequest {
            val json = JSONObject(intent.getStringExtra(CaptureActions.EXTRA_REQUEST) ?: error("Missing capture request"))
            return CaptureRequest(
                sessionId = json.getString("session_id"),
                programId = json.getString("program_id"),
                programRevision = json.getInt("program_revision"),
                devicePseudonym = json.getString("device_pseudonym"),
                participantCode = json.getString("participant_code"),
                placement = json.getString("placement"),
                routeId = json.getString("route_id"),
                protocolCellId = json.getString("protocol_cell_id"),
                split = json.getString("split"),
                lifecycle = LifecycleProtocol.fromKey(json.getString("lifecycle")),
                motionCondition = MotionCondition.fromKey(json.getString("motion_condition")),
                plannedDurationSeconds = json.getInt("planned_duration_s"),
                mode = CaptureMode.fromKey(json.getString("mode")),
                requestStepSensors = json.getBoolean("request_step_sensors"),
                requestLocation = json.getBoolean("request_location"),
                holdWakeLock = json.getBoolean("hold_wake_lock"),
            )
        }
    }
}

object SensorNames {
    private val names = mapOf(
        Sensor.TYPE_ACCELEROMETER to "TYPE_ACCELEROMETER",
        Sensor.TYPE_MAGNETIC_FIELD to "TYPE_MAGNETIC_FIELD",
        Sensor.TYPE_GYROSCOPE to "TYPE_GYROSCOPE",
        Sensor.TYPE_PRESSURE to "TYPE_PRESSURE",
        Sensor.TYPE_GRAVITY to "TYPE_GRAVITY",
        Sensor.TYPE_LINEAR_ACCELERATION to "TYPE_LINEAR_ACCELERATION",
        Sensor.TYPE_ROTATION_VECTOR to "TYPE_ROTATION_VECTOR",
        Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED to "TYPE_MAGNETIC_FIELD_UNCALIBRATED",
        Sensor.TYPE_GAME_ROTATION_VECTOR to "TYPE_GAME_ROTATION_VECTOR",
        Sensor.TYPE_GYROSCOPE_UNCALIBRATED to "TYPE_GYROSCOPE_UNCALIBRATED",
        Sensor.TYPE_STEP_DETECTOR to "TYPE_STEP_DETECTOR",
        Sensor.TYPE_STEP_COUNTER to "TYPE_STEP_COUNTER",
        Sensor.TYPE_ACCELEROMETER_UNCALIBRATED to "TYPE_ACCELEROMETER_UNCALIBRATED",
    )

    fun of(type: Int): String = names[type] ?: "TYPE_$type"

    val required = setOf(Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GYROSCOPE)
    val standardOptional = listOf(
        Sensor.TYPE_ACCELEROMETER_UNCALIBRATED,
        Sensor.TYPE_GYROSCOPE_UNCALIBRATED,
        Sensor.TYPE_MAGNETIC_FIELD,
        Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED,
        Sensor.TYPE_ROTATION_VECTOR,
        Sensor.TYPE_GAME_ROTATION_VECTOR,
        Sensor.TYPE_GRAVITY,
        Sensor.TYPE_LINEAR_ACCELERATION,
        Sensor.TYPE_PRESSURE,
    )
    val step = listOf(Sensor.TYPE_STEP_DETECTOR, Sensor.TYPE_STEP_COUNTER)
}

fun reportingModeName(mode: Int): String = when (mode) {
    Sensor.REPORTING_MODE_CONTINUOUS -> "continuous"
    Sensor.REPORTING_MODE_ON_CHANGE -> "on-change"
    Sensor.REPORTING_MODE_ONE_SHOT -> "one-shot"
    Sensor.REPORTING_MODE_SPECIAL_TRIGGER -> "special-trigger"
    else -> "unknown-$mode"
}
