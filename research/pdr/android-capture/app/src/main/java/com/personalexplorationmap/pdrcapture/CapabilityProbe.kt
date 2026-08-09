package com.personalexplorationmap.pdrcapture

import android.hardware.Sensor
import android.hardware.SensorManager
import org.json.JSONObject

data class CapabilitySnapshot(
    val records: List<JSONObject>,
    val availableTypes: Set<Int>,
    val requiredMissing: Set<Int>,
) {
    val supportsImu6: Boolean get() = requiredMissing.isEmpty()
}

fun probeCapabilities(sensorManager: SensorManager, sessionId: String): CapabilitySnapshot {
    val sensors = sensorManager.getSensorList(Sensor.TYPE_ALL).sortedWith(
        compareBy<Sensor> { it.type }.thenBy { it.vendor }.thenBy { it.name },
    )
    val available = sensors.mapTo(mutableSetOf()) { it.type }
    val records = sensors.map { sensor ->
        JSONObject()
            .put("schema_version", SCHEMA_VERSION)
            .put("record_type", "capability")
            .put("session_id", sessionId)
            .put("sensor_type", SensorNames.of(sensor.type))
            .put("sensor_type_id", sensor.type)
            .put("name", sensor.name)
            .put("vendor", sensor.vendor)
            .put("version", sensor.version)
            .put("resolution", sensor.resolution.toDouble())
            .put("maximum_range", sensor.maximumRange.toDouble())
            .put("power_ma", sensor.power.toDouble())
            .put("min_delay_us", sensor.minDelay)
            .put("max_delay_us", sensor.maxDelay)
            .put("fifo_reserved_event_count", sensor.fifoReservedEventCount)
            .put("fifo_max_event_count", sensor.fifoMaxEventCount)
            .put("is_wake_up", sensor.isWakeUpSensor)
            .put("reporting_mode", reportingModeName(sensor.reportingMode))
    }
    return CapabilitySnapshot(
        records = records,
        availableTypes = available,
        requiredMissing = SensorNames.required - available,
    )
}

fun requestedSensors(request: CaptureRequest): List<Int> = buildList {
    addAll(SensorNames.required.sorted())
    addAll(SensorNames.standardOptional)
    if (request.requestStepSensors) addAll(SensorNames.step)
}.distinct()
