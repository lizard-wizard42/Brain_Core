package com.example.braincore.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

@Composable
fun resolvePalette(choice: ThemeChoice): BrainPalette = when (choice) {
    ThemeChoice.SYSTEM -> if (isSystemInDarkTheme()) DefaultDarkPalette else DefaultLightPalette
    ThemeChoice.DARK -> DefaultDarkPalette
    ThemeChoice.LIGHT -> DefaultLightPalette
    else -> CustomPalettes.getValue(choice)
}

@Composable
fun BrainCoreTheme(choice: ThemeChoice = ThemeChoice.SYSTEM, content: @Composable () -> Unit) {
    val palette = resolvePalette(choice)
    val onPrimary = if (palette.primary.luminance() > 0.35f) palette.background else Color.White
    val scheme = if (palette.light) lightColorScheme(
        primary = palette.primary, secondary = palette.accent, tertiary = palette.secondaryAccent,
        background = palette.background, surface = palette.surface,
        onPrimary = onPrimary, onBackground = palette.text, onSurface = palette.text
    ) else darkColorScheme(
        primary = palette.primary, secondary = palette.accent, tertiary = palette.secondaryAccent,
        background = palette.background, surface = palette.surface,
        onPrimary = onPrimary, onBackground = palette.text, onSurface = palette.text
    )
    CompositionLocalProvider(LocalBrainPalette provides palette) {
        MaterialTheme(colorScheme = scheme, typography = Typography, content = content)
    }
}
