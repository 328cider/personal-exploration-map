package com.personalexplorationmap.pdrcapture

import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipInputStream

@RunWith(AndroidJUnit4::class)
class CaptureInstrumentationTest {
    @Test
    fun testForegroundCaptureFinalizesReplayableBundle() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val context = inst.targetContext
        val root = File(context.filesDir, CAPTURE_ROOT).apply { mkdirs() }
        File(root, "$SESSION_ID.partial").deleteRecursively()
        File(root, "$SESSION_ID.complete").deleteRecursively()

        val activity = inst.startActivitySync(
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        val request = CaptureRequest(
            sessionId = SESSION_ID,
            programId = "pdr-capture-readiness-v1-template",
            programRevision = 1,
            devicePseudonym = "device-emulator",
            participantCode = "P-EMULATOR",
            placement = "hand",
            routeId = "no-walking-emulator",
            protocolCellId = "e0-api35-batch100-250",
            split = "development",
            lifecycle = LifecycleProtocol.FOREGROUND_SCREEN_ON,
            motionCondition = MotionCondition.NO_WALKING,
            plannedDurationSeconds = 60,
            mode = CaptureMode.BATCH_100_250,
            requestStepSensors = false,
            requestLocation = false,
            holdWakeLock = true,
        )
        val start = request.putInto(Intent(context, CaptureService::class.java).setAction(CaptureActions.START))
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start) else context.startService(start)
        // Allow enough steady-state time for the offline coverage/rate gate to be meaningful.
        Thread.sleep(15_000)
        context.startService(Intent(context, CaptureService::class.java).setAction(CaptureActions.STOP))

        val completed = File(root, "$SESSION_ID.complete")
        val deadline = System.currentTimeMillis() + 30_000
        while (!completed.isDirectory && System.currentTimeMillis() < deadline) Thread.sleep(250)
        assertTrue("completed bundle missing", completed.isDirectory)
        assertTrue(File(completed, "COMPLETED").isFile)

        val manifest = JSONObject(File(completed, "session_manifest.json").readText())
        assertEquals("complete", manifest.getString("status"))
        assertEquals("foreground-screen-on", manifest.getJSONObject("protocol").getString("lifecycle"))
        assertEquals("no-walking", manifest.getJSONObject("protocol").getString("motion_condition"))
        assertEquals("batch-100-250", manifest.getJSONObject("capture_config").getString("mode"))
        assertEquals(0L, manifest.getJSONObject("writer").getLong("dropped_records"))
        val sensorFiles = completed.listFiles()?.filter { it.name.startsWith("sensor_events-") }.orEmpty()
        assertTrue("sensor stream missing", sensorFiles.isNotEmpty())
        val sensorText = sensorFiles.joinToString("\n") { it.readText() }
        assertTrue("accelerometer missing", sensorText.contains("TYPE_ACCELEROMETER"))
        assertTrue("gyroscope missing", sensorText.contains("TYPE_GYROSCOPE"))

        val archive = ByteArrayOutputStream()
        exportBundle(completed, archive)
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

    companion object {
        const val SESSION_ID = "emulator-e2e"
    }
}
