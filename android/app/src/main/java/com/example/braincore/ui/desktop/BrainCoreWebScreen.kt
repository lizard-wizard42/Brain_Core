package com.example.braincore.ui.desktop

import android.app.Activity
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.braincore.ui.theme.TextPrimary
import com.example.braincore.ui.theme.TextSecondary
import com.example.braincore.ui.theme.BrainBgDark
import com.example.braincore.ui.theme.ThemeChoice
import com.example.braincore.data.MobileApi
import com.example.braincore.data.MobileApiException
import com.example.braincore.data.MobileCredentials
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONTokener

private fun openOfflineCapture(
    webView: WebView,
    context: android.content.Context,
    onOpenNativeTimeline: () -> Unit,
    onOpenNativeSettings: () -> Unit
) {
    webView.evaluateJavascript("localStorage.getItem('brain-core:active-user-id')") { raw ->
        val webUser = try { JSONTokener(raw).nextValue() as? String } catch (_: Exception) { null }
        val recordingOwner = MobileCredentials.recordingOwnerUserId(context)
        if (webUser != null && recordingOwner != webUser) {
            Toast.makeText(context, "A conta do PC difere da conta das gravações. Confira Ajustes.", Toast.LENGTH_LONG).show()
            onOpenNativeSettings()
        } else if (recordingOwner == null) {
            Toast.makeText(context, "Vincule este aparelho a uma conta antes de gravar offline.", Toast.LENGTH_LONG).show()
            onOpenNativeSettings()
        } else onOpenNativeTimeline()
    }
}

/** Trusted configured HTTPS view for the desktop features; native capture stays separate. */
@Composable
fun BrainCoreWebScreen(
    origin: String,
    targetRoute: String = "/",
    navigationRequest: Int = 0,
    onOpenNativeTimeline: () -> Unit = {},
    onOpenNativeSettings: () -> Unit = {},
    onRequestMicrophonePermission: () -> Unit = {},
    onThemeChanged: (ThemeChoice) -> Unit = {},
    modifier: Modifier = Modifier
) {
    if (origin.isBlank()) {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            Text("Configure o endereço Tailscale em Ajustes para abrir o Brain Core do PC.", color = TextSecondary)
        }
        return
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val backgroundColor = BrainBgDark.toArgb()
    var loadError by remember(origin) { mutableStateOf<String?>(null) }
    var loaded by remember(origin) { mutableStateOf(false) }
    var pendingFileCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    val fileChooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pendingFileCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
        pendingFileCallback = null
    }

    val webView = remember(origin) {
        WebView(context).apply {
            setBackgroundColor(backgroundColor)
            settings.javaScriptEnabled = true
            settings.userAgentString = settings.userAgentString + " BrainCoreAndroid/1"
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true // user-selected attachment URIs
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            BrainCoreNativeBridge.setup(
                webView = this,
                origin = origin,
                context = context,
                scope = scope,
                onRequestMicrophonePermission = onRequestMicrophonePermission
            )
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    if (url != null && sameWebOrigin(origin, url) && loadError == null) {
                        loaded = true
                    }
                }
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (request.isForMainFrame && uri.scheme == "braincore" && uri.path.isNullOrEmpty()) {
                        when (uri.host) {
                            "capture" -> scope.launch {
                                try {
                                    val webUser = withContext(Dispatchers.IO) { MobileApi(context).webLoginUserId() }
                                    val recordingOwner = MobileCredentials.recordingOwnerUserId(context)
                                    if (recordingOwner != null && recordingOwner != webUser) {
                                        Toast.makeText(context, "A conta mudou. Vincule as gravações à conta atual em Ajustes.", Toast.LENGTH_LONG).show()
                                        onOpenNativeSettings()
                                    } else onOpenNativeTimeline()
                                } catch (error: MobileApiException) {
                                    if (error.statusCode == 401) {
                                        Toast.makeText(context, "Faça login no Brain Core antes de gravar.", Toast.LENGTH_LONG).show()
                                    } else openOfflineCapture(view, context, onOpenNativeTimeline, onOpenNativeSettings)
                                } catch (_: Exception) {
                                    // Offline capture keeps the last verified recording owner.
                                    openOfflineCapture(view, context, onOpenNativeTimeline, onOpenNativeSettings)
                                }
                            }
                            "device-settings" -> onOpenNativeSettings()
                        }
                        return true
                    }
                    if (request.isForMainFrame && uri.scheme == "braincore" && uri.host == "theme") {
                        val id = uri.pathSegments.singleOrNull()?.replace('-', '_')?.uppercase()
                        val choice = ThemeChoice.entries.firstOrNull { it.name == id }
                        if (choice != null) onThemeChanged(choice)
                        return true
                    }
                    if (sameWebOrigin(origin, uri.toString())) return false
                    if (uri.scheme in setOf("https", "http", "mailto", "tel")) {
                        try { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) {}
                    }
                    return true
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: android.webkit.WebResourceError
                ) {
                    if (request.isForMainFrame) {
                        loaded = false
                        loadError = "PC indisponível. Confira o Tailscale em Ajustes."
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    val audioRequested = android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                    val androidPermissionGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED
                    if (audioRequested && mayCaptureWebAudio(origin, request.origin.toString(), androidPermissionGranted))
                        request.grant(arrayOf(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    else request.deny()
                }

                override fun onShowFileChooser(
                    webView: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams
                ): Boolean {
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = filePathCallback
                    return try {
                        fileChooser.launch(fileChooserParams.createIntent())
                        true
                    } catch (_: Exception) {
                        pendingFileCallback = null
                        filePathCallback.onReceiveValue(null)
                        false
                    }
                }
            }
            loadUrl(origin.trimEnd('/') + safeWebRoute(targetRoute))
        }
    }
    LaunchedEffect(webView, backgroundColor) {
        webView.setBackgroundColor(backgroundColor)
    }
    LaunchedEffect(webView, targetRoute, navigationRequest, loaded) {
        if (loaded) {
            val route = safeWebRoute(targetRoute)
            webView.evaluateJavascript(
                "window.history.pushState({}, '', '$route'); window.dispatchEvent(new PopStateEvent('popstate'));",
                null
            )
        }
    }
    DisposableEffect(webView) {
        onDispose {
            pendingFileCallback?.onReceiveValue(null)
            pendingFileCallback = null
            webView.destroy()
        }
    }

    Box(modifier = modifier) {
        AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize())
        if (loadError != null) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(loadError.orEmpty(), color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(12.dp))
                Button(onClick = { loaded = false; loadError = null; webView.reload() }) { Text("Tentar novamente") }
                Spacer(Modifier.height(12.dp))
                Button(onClick = {
                    openOfflineCapture(webView, context, onOpenNativeTimeline, onOpenNativeSettings)
                }) { Text("Gravar offline na última conta") }
                Spacer(Modifier.height(8.dp))
                Button(onClick = onOpenNativeSettings) { Text("Ajustes do aparelho") }
            }
        }
    }
}

private fun safeWebRoute(route: String): String = when (route) {
    "/", "/knowledge", "/notes", "/settings", "/remember" -> route
    else -> "/"
}
