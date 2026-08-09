package com.personalexplorationmap.pdrcapture

import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

data class EvidenceFile(
    val stream: String,
    val path: String,
    val records: Long,
    val bytes: Long,
    val sha256: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("stream", stream)
        .put("path", path)
        .put("records", records)
        .put("bytes", bytes)
        .put("sha256", sha256)
}

data class WriterSummary(
    val files: List<EvidenceFile>,
    val streamRecordCounts: Map<String, Long>,
    val droppedRecords: Long,
    val fatalError: String?,
)

class BundleWriter(
    captureRoot: File,
    val sessionId: String,
    startRecord: JSONObject,
) {
    val partialDirectory = File(captureRoot, "$sessionId.partial")
    private val startRecordJson = startRecord.toString()
    private val queue = ArrayBlockingQueue<Command>(16_384)
    private val stopped = CountDownLatch(1)
    private val dropped = AtomicLong(0)
    private val fatal = AtomicReference<String?>(null)
    private val completedFiles = mutableListOf<EvidenceFile>()
    private val streams = linkedMapOf<String, RotatingStream>()
    private val thread: Thread

    init {
        require(!partialDirectory.exists()) { "Session directory already exists" }
        check(partialDirectory.mkdirs()) { "Cannot create capture directory" }
        val startFile = File(partialDirectory, "session_start.json")
        startFile.writeText(startRecord.toString(2) + "\n", StandardCharsets.UTF_8)
        completedFiles += EvidenceFile(
            stream = "session_start",
            path = startFile.name,
            records = 1,
            bytes = startFile.length(),
            sha256 = sha256(startFile),
        )
        thread = Thread(::runWriter, "pdr-jsonl-writer-$sessionId").apply { start() }
    }

    fun append(stream: String, record: JSONObject): Boolean {
        if (fatal.get() != null) {
            dropped.incrementAndGet()
            return false
        }
        val line = record.toString() + "\n"
        val accepted = queue.offer(Command.Line(stream, line))
        if (!accepted) dropped.incrementAndGet()
        return accepted
    }

    fun finalManifestBase(): JSONObject = JSONObject(startRecordJson)

    fun markFatal(message: String) {
        fatal.compareAndSet(null, message)
    }

    fun finish(timeoutSeconds: Long = 60): WriterSummary {
        while (!queue.offer(Command.Stop)) {
            if (fatal.get() != null) {
                queue.clear()
            } else {
                Thread.yield()
            }
        }
        if (!stopped.await(timeoutSeconds, TimeUnit.SECONDS)) {
            fatal.compareAndSet(null, "writer_finish_timeout")
            thread.interrupt()
            if (!stopped.await(5, TimeUnit.SECONDS)) {
                throw IllegalStateException("Writer thread did not stop; partial bundle must not be finalized")
            }
        }
        val files = completedFiles.toList()
        return WriterSummary(
            files = files,
            streamRecordCounts = files.groupBy { it.stream }.mapValues { (_, entries) -> entries.sumOf { it.records } },
            droppedRecords = dropped.get(),
            fatalError = fatal.get(),
        )
    }

    private fun runWriter() {
        try {
            while (true) {
                when (val command = queue.take()) {
                    is Command.Line -> {
                        try {
                            streams.getOrPut(command.stream) {
                                RotatingStream(partialDirectory, command.stream)
                            }.append(command.line)
                        } catch (error: Throwable) {
                            fatal.compareAndSet(null, "${error.javaClass.simpleName}:${error.message}")
                            dropped.incrementAndGet()
                        }
                    }
                    Command.Stop -> break
                }
            }
        } catch (interrupted: InterruptedException) {
            fatal.compareAndSet(null, "writer_interrupted")
            Thread.currentThread().interrupt()
        } finally {
            streams.values.forEach { stream ->
                try {
                    completedFiles += stream.closeAndDescribe()
                } catch (error: Throwable) {
                    fatal.compareAndSet(null, "close_${error.javaClass.simpleName}:${error.message}")
                }
            }
            stopped.countDown()
        }
    }

    private sealed interface Command {
        data class Line(val stream: String, val line: String) : Command
        data object Stop : Command
    }
}

private class RotatingStream(
    private val directory: File,
    private val stream: String,
) {
    private val parts = mutableListOf<Part>()
    private var current: Part = openPart(0)

    fun append(line: String) {
        val bytes = line.toByteArray(StandardCharsets.UTF_8).size.toLong()
        if (current.bytes > 0 && current.bytes + bytes > ROTATE_BYTES) {
            current.writer.flush()
            current.writer.close()
            current = openPart(parts.size)
        }
        current.writer.write(line)
        current.records += 1
        current.bytes += bytes
        if (current.records % 256L == 0L) current.writer.flush()
    }

    fun closeAndDescribe(): List<EvidenceFile> {
        current.writer.flush()
        current.writer.close()
        return parts.map { part ->
            EvidenceFile(
                stream = stream,
                path = part.file.name,
                records = part.records,
                bytes = part.file.length(),
                sha256 = sha256(part.file),
            )
        }
    }

    private fun openPart(index: Int): Part {
        val file = File(directory, "%s-%05d.jsonl".format(stream, index))
        val writer = BufferedWriter(
            OutputStreamWriter(FileOutputStream(file, false), StandardCharsets.UTF_8),
            64 * 1024,
        )
        return Part(file, writer).also { parts += it }
    }

    private data class Part(
        val file: File,
        val writer: BufferedWriter,
        var records: Long = 0,
        var bytes: Long = 0,
    )
}

fun finalizeBundle(
    writer: BundleWriter,
    stopReason: String,
    status: String,
): File {
    require(status in setOf("complete", "invalid", "unsupported")) { "Unknown final status: $status" }
    val endedElapsedRealtimeNs = SystemClock.elapsedRealtimeNanos()
    val summary = writer.finish()
    val finalStatus = resolveFinalStatus(status, summary.fatalError)
    val manifest = writer.finalManifestBase()
        .put("status", finalStatus)
        .put("stop_reason", stopReason)
        .put("ended_elapsed_realtime_ns", endedElapsedRealtimeNs)
        .put("writer", JSONObject()
            .put("dropped_records", summary.droppedRecords)
            .put("fatal_error", summary.fatalError ?: JSONObject.NULL)
            .put("stream_record_counts", JSONObject(summary.streamRecordCounts)))
        .put("files", JSONArray(summary.files.map { it.toJson() }))

    val manifestFile = File(writer.partialDirectory, "session_manifest.json")
    writeDurably(manifestFile, (manifest.toString(2) + "\n").toByteArray(StandardCharsets.UTF_8))
    writeDurably(File(writer.partialDirectory, "COMPLETED"), byteArrayOf())
    val completedDirectory = File(writer.partialDirectory.parentFile, "${writer.sessionId}.complete")
    check(writer.partialDirectory.renameTo(completedDirectory)) { "Cannot atomically finalize capture directory" }
    return completedDirectory
}

internal fun resolveFinalStatus(requestedStatus: String, fatalError: String?): String =
    if (fatalError != null) "invalid" else requestedStatus

fun exportBundle(directory: File, output: java.io.OutputStream) {
    require(
        directory.isDirectory &&
            (directory.name.endsWith(".complete") || directory.name.endsWith(".partial")),
    )
    ZipOutputStream(output.buffered()).use { zip ->
        directory.walkTopDown()
            .filter { it.isFile }
            .sortedBy { it.name }
            .forEach { file ->
                val entry = ZipEntry("${directory.name}/${file.relativeTo(directory).invariantSeparatorsPath}")
                entry.time = 0L
                zip.putNextEntry(entry)
                file.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
    }
}

private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

private fun writeDurably(file: File, content: ByteArray) {
    FileOutputStream(file, false).use { output ->
        output.write(content)
        output.flush()
        output.fd.sync()
    }
}
