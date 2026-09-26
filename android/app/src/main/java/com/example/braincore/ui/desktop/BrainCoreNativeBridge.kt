package com.example.braincore.ui.desktop

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.example.braincore.data.AudioRetention
import com.example.braincore.data.AudioRetentionPreferences
import com.example.braincore.data.BrainCoreDatabase
import com.example.braincore.data.MobileApi
import com.example.braincore.data.MobileApiException
import com.example.braincore.data.MobileCredentials
import com.example.braincore.data.SyncScheduler
import com.example.braincore.service.AudioRecordingService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Modern origin-restricted bridge for communication between trusted web frontend and native Android.
 * Uses WebViewCompat.addWebMessageListener with strict origin matching and isMainFrame checks.
 * Under NO circumstance is the device token (bcmd_...) exposed to JS, logs, or UI.
 */
object BrainCoreNativeBridge {
    const val JS_OBJECT_NAME = "brainCoreNativeBridge"

    fun setup(
        webView: WebView,
        origin: String,
        context: Context,
        scope: CoroutineScope,
        onRequestMicrophonePermission: () -> Unit = {}
    ) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            return
        }

        val allowedOriginRules = setOf(origin)

        WebViewCompat.addWebMessageListener(
            webView,
            JS_OBJECT_NAME,
            allowedOriginRules,
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy
                ) {
                    if (!isMainFrame) return
                    if (!sameWebOrigin(origin, sourceOrigin.toString())) return

                    val raw = message.data ?: return
                    val json = try {
                        JSONObject(raw)
                    } catch (_: Exception) {
                        return
                    }

                    val action = json.optString("action")
                    val requestId = json.optString("requestId")

                    when (action) {
                        "getStatus" -> handleGetStatus(context, view, replyProxy, requestId, scope)
                        "cleanLocal" -> handleCleanLocal(json, context, view, replyProxy, requestId, scope)
                        "linkDevice" -> handleLinkDevice(json, context, view, replyProxy, requestId, scope)
                        "unlinkDevice" -> handleUnlinkDevice(context, view, replyProxy, requestId, scope)
                        "requestMicrophonePermission" -> {
                            onRequestMicrophonePermission()
                            handleGetStatus(context, view, replyProxy, requestId, scope)
                        }
                        "startVoiceSample" -> handleVoiceSample("start", context, view, replyProxy, requestId, scope)
                        "stopVoiceSample" -> handleVoiceSample("stop", context, view, replyProxy, requestId, scope)
                        "cancelVoiceSample" -> handleVoiceSample("cancel", context, view, replyProxy, requestId, scope)
                    }
                }
            }
        )
    }

    private fun safeReply(view: WebView, replyProxy: JavaScriptReplyProxy, payload: JSONObject) {
        val str = payload.toString()
        view.post {
            try {
                replyProxy.postMessage(str)
            } catch (_: Exception) {}
        }
    }

    private fun handleVoiceSample(
        action: String, context: Context, view: WebView, replyProxy: JavaScriptReplyProxy,
        requestId: String, scope: CoroutineScope
    ) {
        scope.launch {
            val reply = JSONObject().put("action", "voiceSampleResult").put("requestId", requestId)
            try {
                when (action) {
                    "start" -> {
                        check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            "Permissão de microfone ausente. Ative em Configurações → Este aparelho."
                        }
                        check(!AudioRecordingService.isRecording.value) { "Pare a gravação principal antes de cadastrar sua voz." }
                        val owner = withContext(Dispatchers.IO) { MobileApi(context).webLoginUserId() }
                        check(NativeVoiceSampleRecorder.start(context, owner)) { "Uma amostra já está sendo gravada." }
                    }
                    "stop" -> {
                        val (sample, owner) = NativeVoiceSampleRecorder.stop()
                        withContext(Dispatchers.IO) { NativeVoiceSampleRecorder.upload(context, sample, owner) }
                    }
                    "cancel" -> NativeVoiceSampleRecorder.cancel()
                }
                reply.put("success", true)
            } catch (error: Exception) {
                reply.put("success", false)
                val message = if (error is MobileApiException && error.statusCode == 503)
                    "O PC não conseguiu processar a amostra agora. Tente novamente."
                else error.message ?: "Não foi possível gravar a amostra"
                reply.put("error", message)
            }
            safeReply(view, replyProxy, reply)
        }
    }

    private fun handleGetStatus(
        context: Context,
        view: WebView,
        replyProxy: JavaScriptReplyProxy,
        requestId: String,
        scope: CoroutineScope
    ) {
        scope.launch {
            val db = BrainCoreDatabase.getInstance(context)
            val stats = withContext(Dispatchers.IO) { db.getLocalSyncStats() }
            val claimable = withContext(Dispatchers.IO) { db.claimableUnownedSessionCount() }
            val days = AudioRetentionPreferences.days(context)
            val eligible = withContext(Dispatchers.IO) { AudioRetention.eligible(context, days) }
            val freeBytes = context.filesDir.usableSpace
            val lowSpaceThreshold = 500L * 1024L * 1024L // 500 MiB threshold
            val isLowSpace = freeBytes < lowSpaceThreshold
            val micGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED

            val linked = MobileCredentials.get(context) != null
            val linkedUserId = MobileCredentials.userId(context)
            val recordingOwnerUserId = MobileCredentials.recordingOwnerUserId(context)
            val deviceId = MobileCredentials.deviceId(context)

            val reply = JSONObject().apply {
                put("action", "status")
                put("requestId", requestId)
                put("linked", linked)
                put("deviceId", deviceId ?: JSONObject.NULL)
                put("linkedUserId", linkedUserId ?: JSONObject.NULL)
                put("recordingOwnerUserId", recordingOwnerUserId ?: JSONObject.NULL)
                put("pendingChunks", stats.pendingChunks)
                put("conflictChunks", stats.conflictChunks)
                put("totalSessions", stats.sessions)
                put("totalChunks", stats.chunks)
                put("audioBytes", stats.audioBytes)
                put("freeSpaceBytes", freeBytes)
                put("isLowSpace", isLowSpace)
                put("eligibleCleanupChunks", eligible.size)
                put("eligibleCleanupBytes", eligible.sumOf { it.sizeBytes })
                put("retentionDays", days)
                put("claimableUnowned", claimable)
                put("microphonePermission", if (micGranted) "granted" else "denied")
                put("nativeRecordingActive", AudioRecordingService.isRecording.value)
            }
            safeReply(view, replyProxy, reply)
        }
    }

    private fun handleCleanLocal(
        json: JSONObject,
        context: Context,
        view: WebView,
        replyProxy: JavaScriptReplyProxy,
        requestId: String,
        scope: CoroutineScope
    ) {
        scope.launch {
            val days = json.optInt("days", AudioRetentionPreferences.days(context))
            val result = withContext(Dispatchers.IO) {
                try {
                    AudioRetention.clean(context, days)
                } catch (_: Exception) {
                    null
                }
            }
            val reply = JSONObject().apply {
                put("action", "cleanLocalResult")
                put("requestId", requestId)
                if (result != null) {
                    put("success", true)
                    put("deletedChunks", result.files)
                    put("freedBytes", result.bytes)
                } else {
                    put("success", false)
                    put("error", "Falha ao executar limpeza local")
                }
            }
            safeReply(view, replyProxy, reply)
        }
    }

    private fun handleLinkDevice(
        json: JSONObject,
        context: Context,
        view: WebView,
        replyProxy: JavaScriptReplyProxy,
        requestId: String,
        scope: CoroutineScope
    ) {
        scope.launch {
            val expectedUserId = json.optString("expectedUserId").trim()
            val confirmSwitch = json.optBoolean("confirmSwitch", false)
            val api = MobileApi(context)

            try {
                // 1. Confirm web session identity with backend before binding
                val webUser = withContext(Dispatchers.IO) { api.webLoginUserId() }
                if (expectedUserId.isNotBlank() && expectedUserId != webUser) {
                    val reply = JSONObject().apply {
                        put("action", "linkResult")
                        put("requestId", requestId)
                        put("success", false)
                        put("error", "user_mismatch")
                        put("message", "A sessão web ativa não corresponde à conta informada.")
                    }
                    safeReply(view, replyProxy, reply)
                    return@launch
                }

                // 2. Prevent silent binding to another account if device already has an owner
                val previousOwner = MobileCredentials.recordingOwnerUserId(context)
                if (previousOwner != null && previousOwner != webUser && !confirmSwitch) {
                    val reply = JSONObject().apply {
                        put("action", "linkResult")
                        put("requestId", requestId)
                        put("success", false)
                        put("error", "account_switch_required")
                        put("message", "Este aparelho possui gravações de outra conta. Confirme a troca para vincular à nova conta.")
                        put("currentOwner", previousOwner)
                        put("targetOwner", webUser)
                    }
                    safeReply(view, replyProxy, reply)
                    return@launch
                }

                // 3. Link after login; scoped token is saved securely in KeyStore (never returned to JS)
                val deviceId = withContext(Dispatchers.IO) {
                    api.linkAfterWebLogin(
                        expectedUserId = webUser,
                        previousUserId = previousOwner,
                        confirmSwitch = confirmSwitch
                    )
                }
                withContext(Dispatchers.IO) {
                    BrainCoreDatabase.getInstance(context).refreshAll()
                }
                SyncScheduler.start(context)

                val reply = JSONObject().apply {
                    put("action", "linkResult")
                    put("requestId", requestId)
                    put("success", true)
                    put("deviceId", deviceId)
                    put("userId", webUser)
                }
                safeReply(view, replyProxy, reply)
            } catch (error: MobileApiException) {
                val message = when (error.statusCode) {
                    401 -> "Faça login no Brain Core antes de vincular."
                    403 -> "A sessão web ativa não corresponde à conta informada."
                    409 -> "Troca de conta requer confirmação explícita."
                    else -> "Falha ao vincular no PC (HTTP ${error.statusCode})."
                }
                val reply = JSONObject().apply {
                    put("action", "linkResult")
                    put("requestId", requestId)
                    put("success", false)
                    put("error", "http_${error.statusCode}")
                    put("message", message)
                }
                safeReply(view, replyProxy, reply)
            } catch (_: Exception) {
                val reply = JSONObject().apply {
                    put("action", "linkResult")
                    put("requestId", requestId)
                    put("success", false)
                    put("error", "offline")
                    put("message", "PC indisponível. Verifique o Tailscale ou abra os ajustes do aparelho.")
                }
                safeReply(view, replyProxy, reply)
            }
        }
    }

    private fun handleUnlinkDevice(
        context: Context,
        view: WebView,
        replyProxy: JavaScriptReplyProxy,
        requestId: String,
        scope: CoroutineScope
    ) {
        scope.launch {
            withContext(Dispatchers.IO) {
                try {
                    MobileApi(context).revokeThisDevice()
                } catch (_: Exception) {}
                MobileCredentials.clear(context)
                BrainCoreDatabase.getInstance(context).refreshAll()
            }
            val reply = JSONObject().apply {
                put("action", "unlinkResult")
                put("requestId", requestId)
                put("success", true)
            }
            safeReply(view, replyProxy, reply)
        }
    }
}
