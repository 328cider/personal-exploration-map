package com.personalexplorationmap.pdrcapture

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener2
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class CaptureService : Service(), SensorEventListener2, LocationListener {
    private lateinit var sensorManager: SensorManager
    private lateinit var locationManager: LocationManager
    private lateinit var sensorThread: HandlerThread
    private lateinit var sensorHandler: Handler
    private lateinit var mainHandler: Handler
    private lateinit var writer: BundleWriter
    private lateinit var request: CaptureRequest
    private var wakeLock: PowerManager.WakeLock? = null
    private val started = AtomicBoolean(false)
    private val stopping = AtomicBoolean(false)
    private val acceptingSensorEvents = AtomicBoolean(false)
    private val acceptingDiagnostics = AtomicBoolean(true)
    private val sensorSequence = AtomicLong(0)
    private val locationSequence = AtomicLong(0)
    private val diagnosticSequence = AtomicLong(0)
    private val registeredSensors = mutableListOf<Sensor>()
    private val pendingFlushTypes = ConcurrentHashMap.newKeySet<Int>()
    @Volatile private var flushLatch: CountDownLatch? = null
    private var startedElapsedRealtimeNs: Long = 0
    private var screenReceiverRegistered = false
    private var locationRegistered = false
    private var thermalListenerRegistered = false

    private val thermalListener = PowerManager.OnThermalStatusChangedListener { thermalStatus ->
        diagnostic("thermal_status_changed", JSONObject().put("thermal_status", thermalStatus))
    }

    private val periodicDiagnostics = object : Runnable {
        override fun run() {
            recordResourceSnapshot("periodic_resource_snapshot", enforceStorageFloor = true)
            if (!stopping.get()) sensorHandler.postDelayed(this, 60_000)
        }
    }

    private val autoStop = Runnable { stopCapture("planned_duration_reached", "complete") }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_ON -> diagnostic("screen_state", JSONObject().put("interactive", true))
                Intent.ACTION_SCREEN_OFF -> diagnostic("screen_state", JSONObject().put("interactive", false))
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        mainHandler = Handler(Looper.getMainLooper())
        sensorThread = HandlerThread("pdr-sensor-callbacks").also { it.start() }
        sensorHandler = Handler(sensorThread.looper)
        createNotificationChannel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            CaptureActions.START -> {
                if (started.compareAndSet(false, true)) {
                    try {
                        startCapture(CaptureRequest.fromIntent(intent))
                    } catch (error: Throwable) {
                        val reason = "start_${error.javaClass.simpleName}"
                        if (::writer.isInitialized) {
                            writer.markFatal(reason)
                            stopCapture("start_failure", "invalid")
                        } else {
                            val sessionId = runCatching { CaptureRequest.fromIntent(intent).sessionId }
                                .getOrDefault("unknown")
                            notifyFinished(sessionId, null, "invalid", reason)
                            stopForeground(STOP_FOREGROUND_REMOVE)
                            stopSelf(startId)
                        }
                    }
                } else if (::writer.isInitialized) {
                    diagnostic("duplicate_start_ignored")
                }
            }
            CaptureActions.STOP -> stopCapture("user_stop", "complete")
            CaptureActions.MARK_SYNC -> diagnostic("operator_sync_marker")
            CaptureActions.ACTIVITY_STATE -> diagnostic(
                "activity_state",
                JSONObject()
                    .put("state", intent.getStringExtra(CaptureActions.EXTRA_STATE) ?: "unknown")
                    .put(
                        "source",
                        intent.getStringExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE) ?: "unspecified",
                    ),
            )
        }
        if (intent?.action != CaptureActions.START && !::writer.isInitialized) stopSelf(startId)
        return START_NOT_STICKY
    }

    private fun startCapture(captureRequest: CaptureRequest) {
        check(BuildConfig.RESEARCH_SCHEMA_VERSION == SCHEMA_VERSION) { "Build/schema contract mismatch" }
        request = captureRequest
        startedElapsedRealtimeNs = SystemClock.elapsedRealtimeNanos()
        // startForegroundService callers give the service only a short deadline to promote itself.
        // Promote before validating a rejected request so fail-closed input cannot crash the app.
        // No writer or sensor registration exists at this point, so this is not capture evidence.
        startForegroundCompat(buildNotification(), false)
        require(isMotionCaptureAuthorized(captureRequest.motionCondition)) {
            "This APK revision is not authorized for personal walking capture"
        }
        val actualLocation = request.requestLocation && hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        if (actualLocation) startForegroundCompat(buildNotification(), true)

        val root = File(filesDir, CAPTURE_ROOT).apply { mkdirs() }
        writer = BundleWriter(root, request.sessionId, startRecord(actualLocation))
        getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE)
            .edit().putString(PREF_ACTIVE_SESSION, request.sessionId).apply()
        val capability = probeCapabilities(sensorManager, request.sessionId)
        capability.records.forEach { writer.append("capabilities", it) }
        diagnostic(
            "capability_probe",
            JSONObject()
                .put("sensor_count", capability.records.size)
                .put("supports_imu6", capability.supportsImu6)
                .put("missing_required", JSONArray(capability.requiredMissing.sorted().map(SensorNames::of))),
        )
        val availableBytes = StatFs(filesDir.absolutePath).availableBytes
        val requiredHeadroomBytes = requiredStorageHeadroomBytes(request.plannedDurationSeconds)
        diagnostic(
            "storage_preflight",
            JSONObject()
                .put("available_bytes", availableBytes)
                .put("required_headroom_bytes", requiredHeadroomBytes)
                .put("estimate_bytes_per_second", ESTIMATED_MAX_BYTES_PER_SECOND),
        )
        if (availableBytes < requiredHeadroomBytes) {
            stopCapture("insufficient_storage_headroom", "invalid")
            return
        }

        registerScreenReceiver()
        registerThermalListener()
        acquireWakeLockIfRequested()
        acceptingSensorEvents.set(true)
        val registrationSucceeded = registerSensors()
        registerLocationIfRequested()
        recordResourceSnapshot("capture_started")
        sensorHandler.postDelayed(periodicDiagnostics, 60_000)
        if (request.plannedDurationSeconds > 0) {
            mainHandler.postDelayed(autoStop, request.plannedDurationSeconds * 1000L)
        }
        if (!capability.supportsImu6 || !registrationSucceeded) {
            stopCapture("required_sensor_unavailable_or_registration_failed", "unsupported")
        }
    }

    private fun startForegroundCompat(notification: Notification, locationEnabled: Boolean) {
        if (Build.VERSION.SDK_INT >= 34) {
            var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            if (locationEnabled) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            startForeground(NOTIFICATION_ID, notification, type)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun registerSensors(): Boolean {
        var requiredSucceeded = true
        requestedSensors(request).forEach { type ->
            val sensor = sensorManager.getDefaultSensor(type)
            if (sensor == null) {
                diagnostic(
                    "sensor_registration",
                    JSONObject().put("sensor_type", SensorNames.of(type)).put("available", false).put("registered", false),
                )
                if (type in SensorNames.required) requiredSucceeded = false
                return@forEach
            }
            if (type in SensorNames.step && !hasActivityRecognitionPermission()) {
                diagnostic(
                    "sensor_registration",
                    JSONObject()
                        .put("sensor_type", SensorNames.of(type))
                        .put("available", true)
                        .put("registered", false)
                        .put("reason", "activity_recognition_permission_denied"),
                )
                return@forEach
            }
            val samplingPeriodUs = samplingPeriodFor(sensor)
            val maxLatencyUs = if (sensor.reportingMode == Sensor.REPORTING_MODE_CONTINUOUS) {
                request.mode.maxReportLatencyUs
            } else {
                0
            }
            val registered = sensorManager.registerListener(
                this,
                sensor,
                samplingPeriodUs,
                maxLatencyUs,
                sensorHandler,
            )
            diagnostic(
                "sensor_registration",
                JSONObject()
                    .put("sensor_type", SensorNames.of(type))
                    .put("available", true)
                    .put("registered", registered)
                    .put("name", sensor.name)
                    .put("vendor", sensor.vendor)
                    .put("sampling_period_us", samplingPeriodUs)
                    .put("max_report_latency_us", maxLatencyUs),
            )
            if (registered) registeredSensors += sensor
            if (type in SensorNames.required && !registered) requiredSucceeded = false
        }
        return requiredSucceeded
    }

    private fun samplingPeriodFor(sensor: Sensor): Int = when (sensor.type) {
        Sensor.TYPE_PRESSURE -> 200_000
        Sensor.TYPE_MAGNETIC_FIELD, Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED -> 40_000
        Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_GAME_ROTATION_VECTOR -> 20_000
        Sensor.TYPE_STEP_COUNTER, Sensor.TYPE_STEP_DETECTOR -> SensorManager.SENSOR_DELAY_NORMAL
        else -> request.mode.samplingPeriodUs
    }

    private fun registerLocationIfRequested() {
        if (!request.requestLocation) {
            diagnostic("location_registration", JSONObject().put("requested", false).put("registered", false))
            return
        }
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            diagnostic(
                "location_registration",
                JSONObject().put("requested", true).put("registered", false).put("reason", "permission_denied"),
            )
            return
        }
        val providerEnabled = runCatching { locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)
        if (!providerEnabled) {
            diagnostic(
                "location_registration",
                JSONObject().put("requested", true).put("registered", false).put("reason", "gps_provider_disabled"),
            )
            return
        }
        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                1_000L,
                0f,
                this,
                sensorThread.looper,
            )
            locationRegistered = true
            diagnostic(
                "location_registration",
                JSONObject().put("requested", true).put("registered", true).put("provider", LocationManager.GPS_PROVIDER),
            )
        } catch (error: SecurityException) {
            diagnostic(
                "location_registration",
                JSONObject().put("requested", true).put("registered", false).put("reason", "security_exception"),
            )
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!acceptingSensorEvents.get()) return
        val callbackNs = SystemClock.elapsedRealtimeNanos()
        if (event.values.any { !it.isFinite() }) {
            failCapture("non_finite_sensor_value_${SensorNames.of(event.sensor.type)}")
            return
        }
        val values = JSONArray()
        event.values.forEach { values.put(it.toDouble()) }
        val record = JSONObject()
            .put("schema_version", SCHEMA_VERSION)
            .put("record_type", "sensor_event")
            .put("session_id", request.sessionId)
            .put("sequence_id", sensorSequence.getAndIncrement())
            .put("sensor_type", SensorNames.of(event.sensor.type))
            .put("sensor_timestamp_ns", event.timestamp)
            .put("callback_elapsed_realtime_ns", callbackNs)
            .put("accuracy", event.accuracy)
            .put("values", values)
            .put("value_count", event.values.size)
        if (!writer.append("sensor_events", record)) failCapture("writer_queue_overflow")
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        diagnostic(
            "sensor_accuracy_changed",
            JSONObject().put("sensor_type", SensorNames.of(sensor.type)).put("accuracy", accuracy),
        )
    }

    override fun onFlushCompleted(sensor: Sensor) {
        diagnostic("sensor_flush_completed", JSONObject().put("sensor_type", SensorNames.of(sensor.type)))
        if (pendingFlushTypes.remove(sensor.type)) flushLatch?.countDown()
    }

    override fun onLocationChanged(location: Location) {
        if (stopping.get()) return
        val callbackNs = SystemClock.elapsedRealtimeNanos()
        val hasElapsedUncertainty = Build.VERSION.SDK_INT >= 29 && location.hasElapsedRealtimeUncertaintyNanos()
        val record = JSONObject()
            .put("schema_version", SCHEMA_VERSION)
            .put("record_type", "location_event")
            .put("session_id", request.sessionId)
            .put("sequence_id", locationSequence.getAndIncrement())
            .put("provider", location.provider ?: "unknown")
            .put("location_elapsed_realtime_ns", location.elapsedRealtimeNanos)
            .put("has_elapsed_realtime_uncertainty", hasElapsedUncertainty)
            .put(
                "elapsed_realtime_uncertainty_ns",
                nullable(hasElapsedUncertainty, if (Build.VERSION.SDK_INT >= 29) location.elapsedRealtimeUncertaintyNanos else 0.0),
            )
            .put("callback_elapsed_realtime_ns", callbackNs)
            .put("wall_time_ms", location.time)
            .put("latitude_deg", location.latitude)
            .put("longitude_deg", location.longitude)
            .put("has_accuracy", location.hasAccuracy())
            .put("accuracy_m", nullable(location.hasAccuracy(), location.accuracy.toDouble()))
            .put("has_altitude", location.hasAltitude())
            .put("altitude_m", nullable(location.hasAltitude(), location.altitude))
            .put("has_vertical_accuracy", location.hasVerticalAccuracy())
            .put("vertical_accuracy_m", nullable(location.hasVerticalAccuracy(), location.verticalAccuracyMeters.toDouble()))
            .put("has_speed", location.hasSpeed())
            .put("speed_mps", nullable(location.hasSpeed(), location.speed.toDouble()))
            .put("has_speed_accuracy", location.hasSpeedAccuracy())
            .put("speed_accuracy_mps", nullable(location.hasSpeedAccuracy(), location.speedAccuracyMetersPerSecond.toDouble()))
            .put("has_bearing", location.hasBearing())
            .put("bearing_deg", nullable(location.hasBearing(), location.bearing.toDouble()))
            .put("has_bearing_accuracy", location.hasBearingAccuracy())
            .put("bearing_accuracy_deg", nullable(location.hasBearingAccuracy(), location.bearingAccuracyDegrees.toDouble()))
            .put("is_mock", isMockLocation(location))
        if (!writer.append("location_events", record)) failCapture("writer_queue_overflow")
    }

    override fun onProviderEnabled(provider: String) {
        diagnostic("location_provider", JSONObject().put("provider", provider).put("enabled", true))
    }

    override fun onProviderDisabled(provider: String) {
        diagnostic("location_provider", JSONObject().put("provider", provider).put("enabled", false))
    }

    @Deprecated("Deprecated by Android; retained for API compatibility")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {
        diagnostic("location_provider_status", JSONObject().put("provider", provider).put("status", status))
    }

    private fun nullable(hasValue: Boolean, value: Any): Any = if (hasValue) value else JSONObject.NULL

    @Synchronized
    private fun diagnostic(event: String, payload: JSONObject = JSONObject()) {
        if (!::writer.isInitialized || !acceptingDiagnostics.get()) return
        val record = JSONObject()
            .put("schema_version", SCHEMA_VERSION)
            .put("record_type", "diagnostic_event")
            .put("session_id", request.sessionId)
            .put("sequence_id", diagnosticSequence.getAndIncrement())
            .put("elapsed_realtime_ns", SystemClock.elapsedRealtimeNanos())
            .put("event", event)
            .put("payload", payload)
        writer.append("diagnostic_events", record)
    }

    private fun recordResourceSnapshot(event: String, enforceStorageFloor: Boolean = false) {
        val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val power = getSystemService(POWER_SERVICE) as PowerManager
        val storage = StatFs(filesDir.absolutePath)
        val payload = JSONObject()
            .put("battery_level", level)
            .put("battery_scale", scale)
            .put("battery_fraction", if (level >= 0 && scale > 0) level.toDouble() / scale else JSONObject.NULL)
            .put("battery_status", battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1)
            .put("battery_plugged", battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1) ?: -1)
            .put("battery_temperature_tenths_c", battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1)
            .put("battery_voltage_mv", battery?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1)
            .put("thermal_status", if (Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else -1)
            .put("screen_interactive", power.isInteractive)
            .put("storage_available_bytes", storage.availableBytes)
            .put("storage_total_bytes", storage.totalBytes)
            .put("wake_lock_held", wakeLock?.isHeld == true)
        diagnostic(event, payload)
        if (enforceStorageFloor && storage.availableBytes < MIN_STORAGE_HEADROOM_BYTES && !stopping.get()) {
            failCapture("runtime_storage_below_headroom")
        }
    }

    @Suppress("DEPRECATION")
    private fun isMockLocation(location: Location): Boolean =
        if (Build.VERSION.SDK_INT >= 31) location.isMock else location.isFromMockProvider

    private fun registerScreenReceiver() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(screenReceiver, filter)
        }
        screenReceiverRegistered = true
    }

    private fun acquireWakeLockIfRequested() {
        if (!request.holdWakeLock) {
            diagnostic("wake_lock", JSONObject().put("requested", false).put("held", false))
            return
        }
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:pdr-capture").apply {
            setReferenceCounted(false)
            acquire(6 * 60 * 60 * 1000L)
        }
        diagnostic("wake_lock", JSONObject().put("requested", true).put("held", wakeLock?.isHeld == true))
    }

    private fun registerThermalListener() {
        if (Build.VERSION.SDK_INT < 29) {
            diagnostic("thermal_listener", JSONObject().put("available", false).put("registered", false))
            return
        }
        val power = getSystemService(POWER_SERVICE) as PowerManager
        runCatching { power.addThermalStatusListener(mainExecutor, thermalListener) }
            .onSuccess {
                thermalListenerRegistered = true
                diagnostic("thermal_listener", JSONObject().put("available", true).put("registered", true))
            }
            .onFailure { error ->
                diagnostic(
                    "thermal_listener",
                    JSONObject()
                        .put("available", true)
                        .put("registered", false)
                        .put("reason", error.javaClass.simpleName),
                )
            }
    }

    private fun removeThermalListener() {
        if (Build.VERSION.SDK_INT >= 29 && thermalListenerRegistered) {
            val power = getSystemService(POWER_SERVICE) as PowerManager
            runCatching { power.removeThermalStatusListener(thermalListener) }
            thermalListenerRegistered = false
        }
    }

    private fun hasActivityRecognitionPermission(): Boolean =
        Build.VERSION.SDK_INT < 29 || hasPermission(Manifest.permission.ACTIVITY_RECOGNITION)

    private fun hasPermission(permission: String): Boolean = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun failCapture(reason: String) {
        if (::writer.isInitialized) writer.markFatal(reason)
        mainHandler.post { stopCapture(reason, "invalid") }
    }

    @Synchronized
    private fun stopCapture(reason: String, status: String) {
        if (!::writer.isInitialized || !stopping.compareAndSet(false, true)) return
        mainHandler.removeCallbacks(autoStop)
        sensorHandler.removeCallbacks(periodicDiagnostics)
        diagnostic("capture_stopping", JSONObject().put("reason", reason).put("requested_status", status))
        recordResourceSnapshot("final_resource_snapshot")
        val flushTypes = registeredSensors.map { it.type }.toSet()
        pendingFlushTypes.clear()
        pendingFlushTypes.addAll(flushTypes)
        flushLatch = CountDownLatch(flushTypes.size)
        val flushAccepted = if (flushTypes.isEmpty()) {
            false
        } else {
            runCatching { sensorManager.flush(this) }.getOrDefault(false)
        }
        if (!flushAccepted) {
            pendingFlushTypes.clear()
            repeat(flushTypes.size) { flushLatch?.countDown() }
        }
        diagnostic(
            "sensor_flush_requested",
            JSONObject()
                .put("accepted", flushAccepted)
                .put("expected_sensor_types", JSONArray(flushTypes.sorted().map(SensorNames::of)))
                .put("max_report_latency_us", request.mode.maxReportLatencyUs),
        )

        Thread({
            val flushTimeoutMs = maxOf(2_000L, request.mode.maxReportLatencyUs / 1_000L + 2_000L)
            val flushCompleted = flushAccepted && (flushLatch?.await(flushTimeoutMs, TimeUnit.MILLISECONDS) == true)
            var finalStatus = status
            var finalReason = reason
            if (flushAccepted && !flushCompleted) {
                val missing = pendingFlushTypes.sorted().map(SensorNames::of)
                diagnostic(
                    "sensor_flush_timeout",
                    JSONObject().put("timeout_ms", flushTimeoutMs).put("missing_sensor_types", JSONArray(missing)),
                )
                finalStatus = "invalid"
                finalReason = "${reason}_sensor_flush_timeout"
            } else if (!flushAccepted) {
                diagnostic("sensor_flush_required_but_rejected")
                finalStatus = "invalid"
                finalReason = "${reason}_sensor_flush_rejected"
            }

            sensorManager.unregisterListener(this)
            if (locationRegistered) runCatching { locationManager.removeUpdates(this) }
            val callbacksDrained = CountDownLatch(1)
            sensorHandler.post {
                acceptingSensorEvents.set(false)
                callbacksDrained.countDown()
            }
            if (!callbacksDrained.await(5, TimeUnit.SECONDS)) {
                writer.markFatal("sensor_callback_drain_timeout")
                finalStatus = "invalid"
                finalReason = "${reason}_sensor_callback_drain_timeout"
            }
            if (screenReceiverRegistered) runCatching { unregisterReceiver(screenReceiver) }
            removeThermalListener()
            wakeLock?.let { lock -> if (lock.isHeld) lock.release() }
            val mainCallbacksDrained = CountDownLatch(1)
            mainHandler.post {
                acceptingDiagnostics.set(false)
                mainCallbacksDrained.countDown()
            }
            if (!mainCallbacksDrained.await(5, TimeUnit.SECONDS)) {
                writer.markFatal("main_callback_drain_timeout")
                finalStatus = "invalid"
                finalReason = "${reason}_main_callback_drain_timeout"
            }

            val completed = runCatching {
                finalizeBundle(writer, finalReason, finalStatus)
            }
            if (completed.isFailure) {
                finalStatus = "invalid"
                finalReason = "${finalReason}_finalize_${completed.exceptionOrNull()?.javaClass?.simpleName ?: "failure"}"
            }
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE).edit().remove(PREF_ACTIVE_SESSION).apply()
            notifyFinished(request.sessionId, completed.getOrNull(), finalStatus, finalReason)
            sensorThread.quitSafely()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }, "pdr-capture-finalizer").start()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        diagnostic("task_removed")
        super.onTaskRemoved(rootIntent)
    }

    override fun onTrimMemory(level: Int) {
        diagnostic("trim_memory", JSONObject().put("level", level))
        super.onTrimMemory(level)
    }

    override fun onLowMemory() {
        diagnostic("low_memory")
        super.onLowMemory()
    }

    override fun onDestroy() {
        if (::writer.isInitialized && stopping.compareAndSet(false, true)) {
            diagnostic("service_destroyed_before_finalize")
            writer.markFatal("service_destroyed_before_finalize")
            acceptingSensorEvents.set(false)
            sensorManager.unregisterListener(this)
            if (locationRegistered) runCatching { locationManager.removeUpdates(this) }
            if (screenReceiverRegistered) runCatching { unregisterReceiver(screenReceiver) }
            removeThermalListener()
            runCatching { writer.finish(5) }
            sensorThread.quitSafely()
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE).edit().remove(PREF_ACTIVE_SESSION).apply()
        }
        wakeLock?.let { if (it.isHeld) it.release() }
        if (::sensorThread.isInitialized) sensorThread.quitSafely()
        super.onDestroy()
    }

    private fun startRecord(actualLocationEnabled: Boolean): JSONObject {
        val permissions = JSONObject()
            .put("post_notifications", Build.VERSION.SDK_INT < 33 || hasPermission(Manifest.permission.POST_NOTIFICATIONS))
            .put("activity_recognition", hasActivityRecognitionPermission())
            .put("coarse_location", hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION))
            .put("fine_location", hasPermission(Manifest.permission.ACCESS_FINE_LOCATION))
        return JSONObject()
            .put("schema_version", SCHEMA_VERSION)
            .put("session_id", request.sessionId)
            .put("status", "recording")
            .put("started_elapsed_realtime_ns", startedElapsedRealtimeNs)
            .put("started_wall_time_ms", System.currentTimeMillis())
            .put("protocol", JSONObject()
                .put("program_id", request.programId)
                .put("program_revision", request.programRevision)
                .put("cell_id", request.protocolCellId)
                .put("participant_code", request.participantCode)
                .put("device_pseudonym", request.devicePseudonym)
                .put("placement", request.placement)
                .put("route_id", request.routeId)
                .put("split", request.split)
                .put("lifecycle", request.lifecycle.key)
                .put("motion_condition", request.motionCondition.key)
                .put("planned_duration_s", request.plannedDurationSeconds))
            .put("capture_config", JSONObject()
                .put("mode", request.mode.key)
                .put("target_rate_hz", request.mode.targetRateHz)
                .put("sampling_period_us", request.mode.samplingPeriodUs)
                .put("max_report_latency_us", request.mode.maxReportLatencyUs)
                .put("step_sensors_requested", request.requestStepSensors)
                .put("location_requested", request.requestLocation)
                .put("location_enabled_actual", actualLocationEnabled)
                .put("wake_lock_requested", request.holdWakeLock))
            .put("app", JSONObject()
                .put("application_id", BuildConfig.APPLICATION_ID)
                .put("version_name", BuildConfig.VERSION_NAME)
                .put("version_code", BuildConfig.VERSION_CODE)
                .put("build_type", BuildConfig.BUILD_TYPE)
                .put("research_revision", BuildConfig.RESEARCH_REVISION))
            .put("device", JSONObject()
                .put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL)
                .put("product", Build.PRODUCT)
                .put("hardware", Build.HARDWARE)
                .put("android_api", Build.VERSION.SDK_INT)
                .put("android_release", Build.VERSION.RELEASE)
                .put("build_fingerprint", Build.FINGERPRINT))
            .put("permissions", permissions)
    }

    private fun buildNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java)
                .putExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE, "notification"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, CaptureService::class.java).setAction(CaptureActions.STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val syncIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, CaptureService::class.java).setAction(CaptureActions.MARK_SYNC),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("PDR research capture")
            .setContentText("Raw IMU stays on this device until explicit export")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(Notification.Action.Builder(null, "Sync mark", syncIntent).build())
            .addAction(Notification.Action.Builder(null, "Stop", stopIntent).build())
            .build()
    }

    private fun notifyFinished(sessionId: String, bundle: File?, outcome: String, reason: String) {
        val finishedIntent = Intent(CaptureActions.FINISHED)
            .setPackage(packageName)
            .putExtra(CaptureActions.EXTRA_SESSION_ID, sessionId)
            .putExtra(CaptureActions.EXTRA_OUTCOME, outcome)
            .putExtra(CaptureActions.EXTRA_REASON, reason)
        bundle?.let { finishedIntent.putExtra(CaptureActions.EXTRA_BUNDLE_PATH, it.absolutePath) }
        sendBroadcast(finishedIntent)
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "PDR research capture",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Visible while raw motion-sensor evidence is being recorded"
            setShowBadge(false)
        }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "pdr-research-capture"
        private const val NOTIFICATION_ID = 4105
    }
}
