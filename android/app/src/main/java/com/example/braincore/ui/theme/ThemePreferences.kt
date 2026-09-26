package com.example.braincore.ui.theme

import android.content.Context

enum class ThemeChoice(val label: String, val context: String) {
    SYSTEM("Seguir sistema", "Acompanha o modo do Android"),
    DARK("Escuro", "Visual padrão"),
    LIGHT("Claro", "Leitura em ambiente iluminado"),
    DEEP_SEA("Deep Sea", "Refrigeração e trabalho técnico"),
    CYBER_SUNSET("Cyber Sunset", "Criatividade e projetos"),
    MINTY_FRESH("Minty Fresh", "Rotinas e bem-estar"),
    CLOUD_WHITE("Cloud White", "Documentos e notas fiscais"),
    NEON_SKYLINE("Neon Skyline", "Painéis e operações"),
    Y2K_ARCADE("Y2K Arcade", "Ideias e experimentos")
}

object ThemePreferences {
    private const val FILE = "brain_core_appearance"
    private const val KEY = "theme_choice"

    fun get(context: Context): ThemeChoice =
        runCatching {
            ThemeChoice.valueOf(context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
                .getString(KEY, ThemeChoice.SYSTEM.name).orEmpty())
        }.getOrDefault(ThemeChoice.SYSTEM)

    fun save(context: Context, choice: ThemeChoice) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit().putString(KEY, choice.name).apply()
    }
}
