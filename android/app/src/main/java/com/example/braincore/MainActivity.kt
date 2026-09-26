package com.example.braincore

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.example.braincore.ui.settings.SettingsScreen
import com.example.braincore.ui.theme.BrainBgDark
import com.example.braincore.ui.theme.BrainCoreTheme
import com.example.braincore.ui.theme.ThemeChoice
import com.example.braincore.ui.theme.ThemePreferences
import com.example.braincore.ui.theme.resolvePalette
import com.example.braincore.ui.timeline.TimelineScreen
import com.example.braincore.data.ServerSettings
import com.example.braincore.ui.desktop.BrainCoreWebScreen

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        // Permissões concedidas / processadas
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val systemBarColor = ContextCompat.getColor(this, R.color.brain_background)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(systemBarColor),
            navigationBarStyle = SystemBarStyle.dark(systemBarColor)
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        requestAppPermissions()

        setContent {
            var themeChoice by remember { mutableStateOf(ThemePreferences.get(this)) }
            val palette = resolvePalette(themeChoice)
            SideEffect {
                val color = palette.background.toArgb()
                window.statusBarColor = color
                window.navigationBarColor = color
                androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
                    .isAppearanceLightStatusBars = palette.light
                androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
                    .isAppearanceLightNavigationBars = palette.light
            }
            BrainCoreTheme(themeChoice) {
                MainAppScreen(
                    onThemeChanged = {
                        ThemePreferences.save(this, it)
                        themeChoice = it
                    },
                    onRequestMicrophonePermission = { requestAppPermissions() }
                )
            }
        }
    }

    private fun requestAppPermissions() {
        val permissions = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        }
    }
}

private enum class NativeScreen { WEB, TIMELINE, SETTINGS }

@Composable
fun MainAppScreen(
    onThemeChanged: (ThemeChoice) -> Unit,
    onRequestMicrophonePermission: () -> Unit = {}
) {
    val context = LocalContext.current
    var serverUrl by remember { mutableStateOf(ServerSettings.get(context)) }
    var screen by remember { mutableStateOf(if (serverUrl.isBlank()) NativeScreen.SETTINGS else NativeScreen.WEB) }
    var webRoute by remember { mutableStateOf("/") }
    var webNavigationRequest by remember { mutableIntStateOf(0) }

    fun openWeb(route: String = "/") {
        webRoute = route
        webNavigationRequest++
        screen = NativeScreen.WEB
    }

    Surface(modifier = Modifier.fillMaxSize(), color = BrainBgDark) {
        Box(Modifier.fillMaxSize().safeDrawingPadding()) {
            if (serverUrl.isNotBlank() && screen == NativeScreen.WEB) {
                BrainCoreWebScreen(
                    origin = serverUrl,
                    targetRoute = webRoute,
                    navigationRequest = webNavigationRequest,
                    onOpenNativeTimeline = { screen = NativeScreen.TIMELINE },
                    onOpenNativeSettings = { screen = NativeScreen.SETTINGS },
                    onRequestMicrophonePermission = onRequestMicrophonePermission,
                    onThemeChanged = onThemeChanged,
                    modifier = Modifier.fillMaxSize()
                )
            }
            if (screen != NativeScreen.WEB) {
                Column(Modifier.fillMaxSize()) {
                    if (serverUrl.isNotBlank()) {
                        TextButton(onClick = { openWeb(if (screen == NativeScreen.TIMELINE) "/remember" else "/") }) {
                            Text("← Voltar ao Brain Core")
                        }
                    }
                    Box(Modifier.weight(1f)) {
                        when (screen) {
                            NativeScreen.TIMELINE -> TimelineScreen()
                            NativeScreen.SETTINGS -> SettingsScreen(
                                onServerUrlSaved = {
                                    serverUrl = it
                                    openWeb()
                                },
                                onOpenAccount = { openWeb("/settings") }
                            )
                            NativeScreen.WEB -> Unit
                        }
                    }
                }
            }
        }
    }
}
