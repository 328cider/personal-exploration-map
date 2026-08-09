package com.personalexplorationmap.pdrcapture

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipInputStream

@RunWith(AndroidJUnit4::class)
class CaptureInstrumentationTest {
    @Test
    fun testColdStartShowsBuildCapabilityAndSafeC0Defaults() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val activity = inst.startActivitySync(
            Intent(inst.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        inst.waitForIdleSync()
        val visibleText = collectText(activity.window.decorView)
        assertTrue(visibleText.contains("PDR raw capture — research only"))
        assertTrue(visibleText.contains("Build: 0.1.0-research"))
        assertTrue(visibleText.contains("IMU6 capability: available"))
        assertTrue(visibleText.contains("c0-screen-on-live50"))
        assertTrue(visibleText.contains("stationary-device-probe"))
        assertTrue(visibleText.contains("Prepared default: c0-screen-on-live50 — stationary, hand, 120 seconds"))
        assertFalse(visibleText.contains("c1-front-right-screen-off-live100"))
        activity.finish()
    }

    @Test
    fun testForegroundCaptureFinalizesReplayableBundleAndExport() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        resetSession(context, SESSION_ID)
        val activity = inst.startActivitySync(
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        startCapture(context, request(SESSION_ID, mode = CaptureMode.BATCH_100_250))
        Thread.sleep(15_000)
        val completed = stopAndAwait(context, SESSION_ID)

        val manifest = JSONObject(File(completed, "session_manifest.json").readText())
        assertEquals("complete", manifest.getString("status"))
        assertEquals("foreground-screen-on", manifest.getJSONObject("protocol").getString("lifecycle"))
        assertEquals("no-walking", manifest.getJSONObject("protocol").getString("motion_condition"))
        assertEquals("batch-100-250", manifest.getJSONObject("capture_config").getString("mode"))
        assertEquals(0L, manifest.getJSONObject("writer").getLong("dropped_records"))
        assertMandatoryStreams(completed)

        val archive = ByteArrayOutputStream()
        exportBundle(completed, archive)
        val archiveFile = File(context.cacheDir, "$SESSION_ID.zip")
        archiveFile.writeBytes(archive.toByteArray())
        val entries = mutableSetOf<String>()
        ZipInputStream(archive.toByteArray().inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                entries += entry.name.substringAfter('/')
            }
        }
        assertTrue(entries.contains("session_manifest.json"))
        assertTrue(entries.contains("COMPLETED"))
        activity.finish()
    }

    @Test
    fun testOptionalPermissionDenialDoesNotBlockMandatoryImuCapture() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION))
        if (Build.VERSION.SDK_INT >= 29) {
            assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION))
        }
        val sessionId = "emulator-optional-denied"
        resetSession(context, sessionId)
        startCapture(
            context,
            request(sessionId, requestStepSensors = true, requestLocation = true),
        )
        Thread.sleep(12_000)
        val completed = stopAndAwait(context, sessionId)
        val manifest = JSONObject(File(completed, "session_manifest.json").readText())
        assertEquals(false, manifest.getJSONObject("capture_config").getBoolean("location_enabled_actual"))
        assertEquals(false, manifest.getJSONObject("permissions").getBoolean("fine_location"))
        assertEquals(0L, manifest.getJSONObject("writer").getLong("dropped_records"))
        assertMandatoryStreams(completed)
        val diagnostics = diagnosticText(completed)
        assertTrue(diagnostics.contains("permission_denied"))
    }

    @Test
    fun testScreenOffBackgroundReturnFinalizesAndRecordsLifecycle() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val sessionId = "emulator-screen-transition"
        resetSession(context, sessionId)
        val activity = inst.startActivitySync(
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        startCapture(
            context,
            request(
                sessionId,
                lifecycle = LifecycleProtocol.SCREEN_ON_TO_OFF,
                mode = CaptureMode.LIVE_100,
            ),
        )
        Thread.sleep(5_000)
        val notifications = (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .activeNotifications
        assertTrue("foreground-service notification missing", notifications.isNotEmpty())
        shell(inst, "input keyevent KEYCODE_HOME")
        Thread.sleep(1_000)
        shell(inst, "input keyevent KEYCODE_POWER")
        Thread.sleep(5_000)
        shell(inst, "input keyevent KEYCODE_POWER")
        shell(inst, "wm dismiss-keyguard")
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                )
                .putExtra(CaptureActions.EXTRA_ACTIVITY_SOURCE, "emulator-return"),
        )
        Thread.sleep(4_000)
        val completed = stopAndAwait(context, sessionId)
        val diagnostics = diagnosticText(completed)
        assertTrue(diagnostics.contains("screen_state"))
        assertTrue(diagnostics.contains("activity_state"))
        assertTrue(diagnostics.contains("hidden"))
        assertTrue(diagnostics.contains("visible"))
        assertMandatoryStreams(completed)
        activity.finish()
    }

    @Test
    fun testWalkingRequestFailsClosedWithoutCreatingCaptureEvidence() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val sessionId = "emulator-walk-rejected"
        resetSession(context, sessionId)
        startCapture(
            context,
            request(sessionId, motionCondition = MotionCondition.WALK),
        )
        Thread.sleep(2_000)
        val root = File(context.filesDir, CAPTURE_ROOT)
        assertFalse(File(root, "$sessionId.partial").exists())
        assertFalse(File(root, "$sessionId.complete").exists())
        assertNull(
            context.getSharedPreferences(STATE_PREFERENCES, Context.MODE_PRIVATE)
                .getString(PREF_ACTIVE_SESSION, null),
        )
    }

    private fun request(
        sessionId: String,
        lifecycle: LifecycleProtocol = LifecycleProtocol.FOREGROUND_SCREEN_ON,
        motionCondition: MotionCondition = MotionCondition.NO_WALKING,
        mode: CaptureMode = CaptureMode.LIVE_50,
        requestStepSensors: Boolean = false,
        requestLocation: Boolean = false,
    ) = CaptureRequest(
        sessionId = sessionId,
        programId = "pdr-capture-readiness-v1-template",
        programRevision = 1,
        devicePseudonym = "device-emulator",
        participantCode = "P-EMULATOR",
        placement = "hand",
        routeId = "no-walking-emulator",
        protocolCellId = if (sessionId == SESSION_ID) "e0-api35-batch100-250" else "e0-$sessionId",
        split = "development",
        lifecycle = lifecycle,
        motionCondition = motionCondition,
        plannedDurationSeconds = 60,
        mode = mode,
        requestStepSensors = requestStepSensors,
        requestLocation = requestLocation,
        holdWakeLock = true,
    )

    private fun startCapture(context: Context, request: CaptureRequest) {
        val intent = request.putInto(Intent(context, CaptureService::class.java).setAction(CaptureActions.START))
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }

    private fun stopAndAwait(context: Context, sessionId: String): File {
        context.startService(Intent(context, CaptureService::class.java).setAction(CaptureActions.STOP))
        val completed = File(File(context.filesDir, CAPTURE_ROOT), "$sessionId.complete")
        val deadline = System.currentTimeMillis() + 30_000
        while (!completed.isDirectory && System.currentTimeMillis() < deadline) Thread.sleep(250)
        assertTrue("completed bundle missing for $sessionId", completed.isDirectory)
        assertTrue(File(completed, "COMPLETED").isFile)
        return completed
    }

    private fun resetSession(context: Context, sessionId: String) {
        val root = File(context.filesDir, CAPTURE_ROOT).apply { mkdirs() }
        File(root, "$sessionId.partial").deleteRecursively()
        File(root, "$sessionId.complete").deleteRecursively()
        File(context.cacheDir, "$sessionId.zip").delete()
        context.getSharedPreferences(STATE_PREFERENCES, Context.MODE_PRIVATE)
            .edit().remove(PREF_ACTIVE_SESSION).commit()
    }

    private fun assertMandatoryStreams(completed: File) {
        val sensorFiles = completed.listFiles()?.filter { it.name.startsWith("sensor_events-") }.orEmpty()
        assertTrue("sensor stream missing", sensorFiles.isNotEmpty())
        val sensorText = sensorFiles.joinToString("\n") { it.readText() }
        assertTrue("accelerometer missing", sensorText.contains("TYPE_ACCELEROMETER"))
        assertTrue("gyroscope missing", sensorText.contains("TYPE_GYROSCOPE"))
    }

    private fun diagnosticText(completed: File): String =
        completed.listFiles()
            ?.filter { it.name.startsWith("diagnostics-") }
            .orEmpty()
            .joinToString("\n") { it.readText() }

    private fun collectText(view: View): String = buildString {
        if (view is TextView) append(view.text).append('\n')
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) append(collectText(view.getChildAt(index)))
        }
    }

    private fun shell(inst: android.app.Instrumentation, command: String) {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(inst.uiAutomation.executeShellCommand(command))
            .use { it.readBytes() }
    }

    companion object {
        const val SESSION_ID = "emulator-e2e"
    }
}
