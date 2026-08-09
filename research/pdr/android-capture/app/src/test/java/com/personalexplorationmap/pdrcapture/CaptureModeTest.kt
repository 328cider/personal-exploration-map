package com.personalexplorationmap.pdrcapture

import org.junit.Assert.fail
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureModeTest {
    @Test
    fun allModesStayWithinAndroidCompatibleRateContract() {
        CaptureMode.entries.forEach { mode ->
            assertTrue(mode.targetRateHz in 50..100)
            assertTrue(mode.samplingPeriodUs >= 10_000)
            assertTrue(mode.maxReportLatencyUs in setOf(0, 250_000))
        }
    }

    @Test
    fun unknownModeIsRejectedInsteadOfSilentlyChangingTheProtocol() {
        try {
            CaptureMode.fromKey("future-mode")
            fail("unknown mode must be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test
    fun protocolEnumsHaveStableUniqueMachineKeys() {
        assertEquals(LifecycleProtocol.entries.size, LifecycleProtocol.entries.map { it.key }.toSet().size)
        assertEquals(MotionCondition.entries.size, MotionCondition.entries.map { it.key }.toSet().size)
    }

    @Test
    fun thisRevisionAuthorizesOnlyNoWalkingCapture() {
        assertTrue(isMotionCaptureAuthorized(MotionCondition.NO_WALKING))
        assertTrue(isMotionCaptureAuthorized(MotionCondition.STATIONARY))
        assertEquals(false, isMotionCaptureAuthorized(MotionCondition.WALK))
        assertEquals(false, isMotionCaptureAuthorized(MotionCondition.MIXED))
    }

    @Test
    fun aWriterFailureCanNeverBeFinalizedAsComplete() {
        assertEquals("complete", resolveFinalStatus("complete", null))
        assertEquals("unsupported", resolveFinalStatus("unsupported", null))
        assertEquals("invalid", resolveFinalStatus("complete", "writer_io_failure"))
    }

    @Test
    fun storagePreflightUsesTheSameBoundedEstimateForUiAndService() {
        assertEquals(
            MIN_STORAGE_HEADROOM_BYTES + 120L * ESTIMATED_MAX_BYTES_PER_SECOND,
            requiredStorageHeadroomBytes(120),
        )
        assertTrue(requiredStorageHeadroomBytes(300) > requiredStorageHeadroomBytes(120))
    }
}
