package com.personalexplorationmap.pdrcapture

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.StatFs
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var capability: TextView
    private lateinit var participant: EditText
    private lateinit var route: EditText
    private lateinit var cell: EditText
    private lateinit var duration: EditText
    private lateinit var placement: Spinner
    private lateinit var mode: Spinner
    private lateinit var lifecycle: Spinner
    private lateinit var motionCondition: Spinner
    private lateinit var step: CheckBox
    private lateinit var location: CheckBox
    private lateinit var wakeLock: CheckBox
    private var pendingRequest: CaptureRequest? = null
    private var pendingExport: File? = null
    private var receiverRegistered = false

    private val finishedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val sessionId = intent?.getStringExtra(CaptureActions.EXTRA_SESSION_ID) ?: "unknown"
            val outcome = intent?.getStringExtra(CaptureActions.EXTRA_OUTCOME) ?: "unknown"
            val reason = intent?.getStringExtra(CaptureActions.EXTRA_REASON) ?: "unspecified"
            refreshStatus("Capture finished: $sessionId; outcome=$outcome; reason=$reason")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        refreshCapability()
        refreshStatus()
    }

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(finishedReceiver, IntentFilter(CaptureActions.FINISHED), RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(finishedReceiver, IntentFilter(CaptureActions.FINISHED))
        }
        receiverRegistered = true
        val active = activeSession()
        if (active != null && !isCaptureServiceRunning()) {
            getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE).edit().remove(PREF_ACTIVE_SESSION).apply()
            refreshStatus("Previous active session is interrupted and remains as .partial: $active")
        } else if (active != null) {
            sendServiceAction(CaptureActions.ACTIVITY_STATE) {
                putExtra(CaptureActions.EXTRA_STATE, "visible")
                putExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE, consumeActivitySource())
            }
        }
    }

    override fun onNewIntent(newIntent: Intent?) {
        super.onNewIntent(newIntent)
        if (newIntent != null) setIntent(newIntent)
        if (activeSession() != null) {
            sendServiceAction(CaptureActions.ACTIVITY_STATE) {
                putExtra(CaptureActions.EXTRA_STATE, "visible")
                putExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE, consumeActivitySource())
            }
        }
    }

    override fun onStop() {
        if (activeSession() != null) {
            sendServiceAction(CaptureActions.ACTIVITY_STATE) {
                putExtra(CaptureActions.EXTRA_STATE, "hidden")
                putExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE, "activity-on-stop")
            }
        }
        if (receiverRegistered) unregisterReceiver(finishedReceiver)
        receiverRegistered = false
        super.onStop()
    }

    @SuppressLint("SetTextI18n")
    private fun buildUi(): View {
        val density = resources.displayMetrics.density
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * density).toInt(), (20 * density).toInt(), (20 * density).toInt(), (40 * density).toInt())
            setBackgroundColor(Color.rgb(244, 246, 248))
        }
        content.addView(TextView(this).apply {
            text = "PDR raw capture — research only"
            textSize = 24f
            setTextColor(Color.rgb(20, 33, 50))
        })
        content.addView(TextView(this).apply {
            text = "Local-only Android evidence. This app does not estimate or write a map."
            textSize = 15f
            setPadding(0, 8, 0, 16)
        })
        capability = TextView(this).also { content.addView(it) }
        status = TextView(this).apply { setPadding(0, 12, 0, 12) }.also { content.addView(it) }
        content.addView(TextView(this).apply {
            text = "Prepared default: c0-screen-on-live50 — stationary, hand, 120 seconds. Collection still requires an authorized device plan."
            setPadding(0, 4, 0, 8)
        })

        participant = textField(content, "Pseudonymous participant code", "P-PILOT-01")
        route = textField(content, "Route / protocol ID", "stationary-device-probe")
        cell = textField(content, "Frozen protocol cell ID", "c0-screen-on-live50")
        duration = textField(content, "Planned duration (seconds)", "120")
        placement = spinner(content, "Placement", PLACEMENTS)
        placement.setSelection(PLACEMENTS.indexOf("hand"))
        content.addView(TextView(this).apply {
            text = "Split: development (v1 cannot create tuning or sealed-validation runs without a future frozen-plan import)"
            setPadding(0, 12, 0, 2)
        })
        mode = spinner(content, "Capture mode", CaptureMode.entries.map { it.key })
        mode.setSelection(CaptureMode.entries.indexOf(CaptureMode.LIVE_50))
        lifecycle = spinner(content, "Declared lifecycle protocol", LifecycleProtocol.entries.map { it.key })
        lifecycle.setSelection(LifecycleProtocol.entries.indexOf(LifecycleProtocol.FOREGROUND_SCREEN_ON))
        motionCondition = spinner(content, "Declared motion condition", AUTHORIZED_MOTION_CONDITIONS.map { it.key })
        motionCondition.setSelection(AUTHORIZED_MOTION_CONDITIONS.indexOf(MotionCondition.STATIONARY))

        step = CheckBox(this).apply { text = "Request optional step sensors" }.also { content.addView(it) }
        location = CheckBox(this).apply { text = "Request optional sparse GNSS (precise location)" }.also { content.addView(it) }
        wakeLock = CheckBox(this).apply {
            text = "Hold partial wake lock during capture"
            isChecked = true
        }.also { content.addView(it) }

        content.addView(Button(this).apply {
            text = "Start capture"
            setOnClickListener { prepareStart() }
        })
        content.addView(Button(this).apply {
            text = "Add external-truth sync marker"
            setOnClickListener { sendServiceAction(CaptureActions.MARK_SYNC) }
        })
        content.addView(Button(this).apply {
            text = "Stop and finalize"
            setOnClickListener { sendServiceAction(CaptureActions.STOP) }
        })
        content.addView(Button(this).apply {
            text = "Export latest complete or interrupted ZIP"
            setOnClickListener { beginExport() }
        })
        content.addView(Button(this).apply {
            text = "Refresh capability / bundle state"
            setOnClickListener {
                refreshCapability()
                refreshStatus()
            }
        })
        content.addView(TextView(this).apply {
            text = "C0 defaults are preparation only until an authorized plan names this device pseudonym. Do not enter a name, email, or location in metadata. Interrupted .partial sessions remain visible and count as failed attempts."
            textSize = 13f
            setPadding(0, 16, 0, 0)
        })
        return ScrollView(this).apply { addView(content) }
    }

    private fun textField(parent: LinearLayout, label: String, initial: String): EditText {
        parent.addView(TextView(this).apply { text = label; setPadding(0, 12, 0, 2) })
        return EditText(this).apply {
            setText(initial)
            isSingleLine = true
        }.also { parent.addView(it) }
    }

    private fun spinner(parent: LinearLayout, label: String, values: List<String>): Spinner {
        parent.addView(TextView(this).apply { text = label; setPadding(0, 12, 0, 2) })
        return Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, values)
        }.also { parent.addView(it) }
    }

    private fun prepareStart() {
        val participantCode = participant.text.toString().trim()
        val routeId = route.text.toString().trim()
        val cellId = cell.text.toString().trim()
        val planned = duration.text.toString().toIntOrNull()
        if (!SAFE_CODE.matches(participantCode) || !SAFE_CODE.matches(routeId) || !SAFE_CODE.matches(cellId)) {
            toast("Participant, route, and cell IDs must use 1-64 letters, numbers, dot, underscore, or dash.")
            return
        }
        if (planned == null || planned !in 60..21_600) {
            toast("Planned duration must be 60-21600 seconds.")
            return
        }
        val request = CaptureRequest(
            sessionId = UUID.randomUUID().toString(),
            programId = DEVELOPMENT_PROGRAM_ID,
            programRevision = DEVELOPMENT_PROGRAM_REVISION,
            devicePseudonym = devicePseudonym(),
            participantCode = participantCode,
            placement = placement.selectedItem.toString(),
            routeId = routeId,
            protocolCellId = cellId,
            split = "development",
            lifecycle = LifecycleProtocol.fromKey(lifecycle.selectedItem.toString()),
            motionCondition = MotionCondition.fromKey(motionCondition.selectedItem.toString()),
            plannedDurationSeconds = planned,
            mode = CaptureMode.fromKey(mode.selectedItem.toString()),
            requestStepSensors = step.isChecked,
            requestLocation = location.isChecked,
            holdWakeLock = wakeLock.isChecked,
        )
        val missing = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing += Manifest.permission.POST_NOTIFICATIONS
        }
        if (request.requestStepSensors && Build.VERSION.SDK_INT >= 29 &&
            checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED
        ) {
            missing += Manifest.permission.ACTIVITY_RECOGNITION
        }
        if (request.requestLocation && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing += Manifest.permission.ACCESS_COARSE_LOCATION
            missing += Manifest.permission.ACCESS_FINE_LOCATION
        }
        pendingRequest = request
        if (missing.isNotEmpty()) {
            requestPermissions(missing.distinct().toTypedArray(), REQUEST_PERMISSIONS)
        } else {
            startRequest(request)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PERMISSIONS) {
            pendingRequest?.let(::startRequest)
            pendingRequest = null
        }
    }

    private fun startRequest(request: CaptureRequest) {
        if (activeSession() != null) {
            toast("A capture is already active. Stop or recover it before starting another attempt.")
            return
        }
        val manager = getSystemService(SENSOR_SERVICE) as SensorManager
        val snapshot = probeCapabilities(manager, request.sessionId)
        if (!snapshot.supportsImu6) {
            toast("This device does not expose both required accelerometer and gyroscope sensors.")
            refreshStatus("Start blocked: required IMU6 capability is unavailable")
            return
        }
        val availableBytes = StatFs(filesDir.absolutePath).availableBytes
        val requiredBytes = requiredStorageHeadroomBytes(request.plannedDurationSeconds)
        if (availableBytes < requiredBytes) {
            toast("Not enough storage headroom for this planned duration.")
            refreshStatus("Start blocked: available storage $availableBytes bytes; required $requiredBytes bytes")
            return
        }
        val intent = request.putInto(Intent(this, CaptureService::class.java).setAction(CaptureActions.START))
        val started = runCatching { startForegroundService(intent) }
        if (started.isFailure) {
            pendingRequest = null
            val error = started.exceptionOrNull()?.javaClass?.simpleName ?: "unknown"
            toast("Capture service could not start: $error")
            refreshStatus("Start failed before capture: $error")
            return
        }
        sendServiceAction(CaptureActions.ACTIVITY_STATE) {
            putExtra(CaptureActions.EXTRA_STATE, "visible")
            putExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE, "capture-start")
        }
        refreshStatus("Start requested: ${request.sessionId}")
    }

    private fun sendServiceAction(action: String, configure: Intent.() -> Unit = {}): Boolean {
        val intent = Intent(this, CaptureService::class.java).setAction(action).apply(configure)
        return runCatching { startService(intent) }.fold(
            onSuccess = { true },
            onFailure = {
                refreshStatus("Service action failed: $action (${it.javaClass.simpleName})")
                false
            },
        )
    }

    private fun refreshCapability() {
        val snapshot = probeCapabilities(getSystemService(SENSOR_SERVICE) as SensorManager, "probe-only")
        val optional = SensorNames.standardOptional.count { it in snapshot.availableTypes }
        capability.text = buildString {
            append("Build: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}); revision ${BuildConfig.RESEARCH_REVISION.take(12)}")
            append("\nDevice pseudonym: ${devicePseudonym()}")
            append("\n")
            append(if (snapshot.supportsImu6) "IMU6 capability: available" else "IMU6 capability: UNSUPPORTED")
            append("\nSensors reported: ${snapshot.records.size}; standard optional types: $optional/${SensorNames.standardOptional.size}")
            if (snapshot.requiredMissing.isNotEmpty()) {
                append("\nMissing: ${snapshot.requiredMissing.joinToString { SensorNames.of(it) }}")
            }
        }
    }

    private fun refreshStatus(prefix: String? = null) {
        val root = File(filesDir, CAPTURE_ROOT)
        val partial = root.listFiles()?.count { it.isDirectory && it.name.endsWith(".partial") } ?: 0
        val complete = root.listFiles()?.count { it.isDirectory && it.name.endsWith(".complete") } ?: 0
        val active = activeSession()
        status.text = listOfNotNull(
            prefix,
            "Active request: ${active ?: "none"}",
            "Completed bundles: $complete; interrupted/active partial bundles: $partial",
        ).joinToString("\n")
    }

    private fun beginExport() {
        val active = activeSession()
        val latest = File(filesDir, CAPTURE_ROOT).listFiles()
            ?.filter {
                it.isDirectory &&
                    (it.name.endsWith(".complete") || it.name.endsWith(".partial")) &&
                    it.name != "$active.partial"
            }
            ?.maxByOrNull { it.lastModified() }
        if (latest == null) {
            toast("No complete or interrupted bundle is available.")
            return
        }
        pendingExport = latest
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/zip")
            .putExtra(Intent.EXTRA_TITLE, "${latest.name}.zip")
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_EXPORT)
    }

    @Deprecated("Uses platform Storage Access Framework without an additional dependency")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_EXPORT || resultCode != RESULT_OK) return
        val source = pendingExport ?: return
        val uri: Uri = data?.data ?: return
        Thread({
            val result = runCatching {
                contentResolver.openOutputStream(uri, "w")!!.use { exportBundle(source, it) }
            }
            runOnUiThread {
                toast(if (result.isSuccess) "Export complete. Validate the ZIP in Docker." else "Export failed: ${result.exceptionOrNull()?.message}")
            }
        }, "pdr-bundle-export").start()
    }

    private fun devicePseudonym(): String {
        val preferences = getSharedPreferences("pdr_capture_identity", MODE_PRIVATE)
        return preferences.getString("device_pseudonym", null) ?: "device-${UUID.randomUUID()}".also {
            preferences.edit().putString("device_pseudonym", it).apply()
        }
    }

    private fun activeSession(): String? =
        getSharedPreferences(STATE_PREFERENCES, MODE_PRIVATE).getString(PREF_ACTIVE_SESSION, null)

    private fun consumeActivitySource(): String {
        val source = intent?.getStringExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE) ?: "activity-on-start"
        intent?.removeExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE)
        return source
    }

    @Suppress("DEPRECATION")
    private fun isCaptureServiceRunning(): Boolean {
        val manager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        return manager.getRunningServices(Int.MAX_VALUE).any {
            it.service.className == CaptureService::class.java.name
        }
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    companion object {
        private const val REQUEST_PERMISSIONS = 100
        private const val REQUEST_EXPORT = 101
        private const val DEVELOPMENT_PROGRAM_ID = "pdr-capture-readiness-v1-template"
        private const val DEVELOPMENT_PROGRAM_REVISION = 1
        private val SAFE_CODE = Regex("[A-Za-z0-9._-]{1,64}")
        private val PLACEMENTS = listOf("front-left", "front-right", "rear-left", "rear-right", "hand", "bag", "other-declared")
        private val AUTHORIZED_MOTION_CONDITIONS = MotionCondition.entries.filter(::isMotionCaptureAuthorized)
    }
}
