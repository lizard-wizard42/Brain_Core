package com.example.braincore.ui.timeline

import android.media.MediaPlayer
import java.io.File

/** Plays recorded chunks in order without overlapping players. */
class AudioPlaybackController {
    private var player: MediaPlayer? = null
    private var files: List<File> = emptyList()
    private var index = 0
    private var onFinished: (() -> Unit)? = null
    private var onFailed: (() -> Unit)? = null

    fun play(files: List<File>, onFinished: () -> Unit, onFailed: () -> Unit) {
        stop()
        require(files.isNotEmpty() && files.all { it.isFile && it.length() > 0L }) {
            "Audio unavailable"
        }
        this.files = files
        this.onFinished = onFinished
        this.onFailed = onFailed
        playNext()
    }

    private fun playNext() {
        if (index >= files.size) {
            val callback = onFinished
            stop()
            callback?.invoke()
            return
        }
        val next = MediaPlayer()
        try {
            next.setDataSource(files[index++].absolutePath)
            next.setOnCompletionListener {
                player?.release()
                player = null
                playNext()
            }
            next.setOnErrorListener { _, _, _ ->
                val callback = onFailed
                stop()
                callback?.invoke()
                true
            }
            next.prepare()
            player = next
            next.start()
        } catch (error: Exception) {
            if (player === next) player = null
            next.release()
            val callback = onFailed
            stop()
            callback?.invoke()
        }
    }

    fun stop() {
        player?.release()
        player = null
        files = emptyList()
        index = 0
        onFinished = null
        onFailed = null
    }
}
