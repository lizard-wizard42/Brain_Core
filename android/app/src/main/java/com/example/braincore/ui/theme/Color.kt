package com.example.braincore.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

data class BrainPalette(
    val background: Color,
    val primary: Color,
    val accent: Color,
    val text: Color,
    val secondaryAccent: Color = accent,
    val light: Boolean = false
) {
    val surface: Color get() = lerp(background, text, if (light) 0.035f else 0.045f)
    val card: Color get() = lerp(background, text, if (light) 0.065f else 0.085f)
    val border: Color get() = lerp(background, text, if (light) 0.16f else 0.13f)
    val secondaryText: Color get() = lerp(background, text, if (light) 0.65f else 0.68f)
    val mutedText: Color get() = lerp(background, text, if (light) 0.46f else 0.48f)
}

val DefaultDarkPalette = BrainPalette(Color(0xFF0F0E0D), Color(0xFF3B82F6), Color(0xFF60A5FA), Color(0xFFF3F4F6))
val DefaultLightPalette = BrainPalette(Color(0xFFF8FAFC), Color(0xFF3B82F6), Color(0xFF6366F1), Color(0xFF1E293B), light = true)

val CustomPalettes = mapOf(
    ThemeChoice.DEEP_SEA to BrainPalette(Color(0xFF0A192F), Color(0xFF00D2FF), Color(0xFF3A7BD5), Color(0xFFE6F1FF)),
    ThemeChoice.CYBER_SUNSET to BrainPalette(Color(0xFF1A0B2E), Color(0xFFFF0080), Color(0xFF7928CA), Color.White),
    ThemeChoice.MINTY_FRESH to BrainPalette(Color(0xFF051612), Color(0xFF00FF87), Color(0xFF60EFFF), Color(0xFFD1FAE5)),
    ThemeChoice.CLOUD_WHITE to BrainPalette(Color(0xFFF8FAFC), Color(0xFF6366F1), Color(0xFF94A3B8), Color(0xFF1E293B), light = true),
    ThemeChoice.NEON_SKYLINE to BrainPalette(Color(0xFF2D3748), Color(0xFF9F7AEA), Color(0xFFED8936), Color(0xFFF7FAFC), Color(0xFF4299E1)),
    ThemeChoice.Y2K_ARCADE to BrainPalette(Color(0xFF1A202C), Color(0xFFECC94B), Color(0xFF805AD5), Color(0xFFE2E8F0), Color(0xFFDD6B20))
)

val LocalBrainPalette = compositionLocalOf { DefaultDarkPalette }

val BrainBgDark: Color @Composable get() = LocalBrainPalette.current.background
val BrainSurfaceDark: Color @Composable get() = LocalBrainPalette.current.surface
val BrainCardDark: Color @Composable get() = LocalBrainPalette.current.card
val BrainBorderDark: Color @Composable get() = LocalBrainPalette.current.border
val BrainBlue: Color @Composable get() = LocalBrainPalette.current.primary
val BrainBlueLight: Color @Composable get() = LocalBrainPalette.current.accent
val BrainBlueMuted: Color @Composable get() = LocalBrainPalette.current.primary.copy(alpha = 0.28f)
val TextPrimary: Color @Composable get() = LocalBrainPalette.current.text
val TextSecondary: Color @Composable get() = LocalBrainPalette.current.secondaryText
val TextMuted: Color @Composable get() = LocalBrainPalette.current.mutedText

val BrainRed = Color(0xFFEF4444)
val BrainGreen = Color(0xFF10B981)
val BrainAmber = Color(0xFFF59E0B)

// User-assigned note colors remain stable across appearance themes.
val NoteSlate = Color(0xFF334155)
val NoteSand = Color(0xFF785B3A)
val NoteRose = Color(0xFF881337)
val NoteSage = Color(0xFF14532D)
val NoteSky = Color(0xFF0369A1)
val NoteAmber = Color(0xFF78350F)
val NoteLavender = Color(0xFF581C87)
