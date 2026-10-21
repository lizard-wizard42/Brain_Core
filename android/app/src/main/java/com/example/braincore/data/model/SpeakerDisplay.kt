package com.example.braincore.data.model

/** Presentation only: a probable match never becomes a stored manual decision. */
object SpeakerDisplay {
    fun fromServer(legacy: String?, voice: String?, probableOwner: Boolean,
                   label: String?, labelIsOwner: Boolean): String = when {
        !label.isNullOrBlank() -> if (labelIsOwner) "me" else "named:$label"
        legacy == "me" || legacy == "other" -> legacy
        probableOwner -> "me_probable"
        voice?.matches(Regex("speaker_\\d+")) == true -> voice
        else -> "unknown"
    }

    fun withDecision(speaker: String, action: String?, name: String?, isOwner: Boolean): String = when (action) {
        "confirm", "correct" -> if (isOwner) "me" else "named:${name?.takeIf { it.isNotBlank() } ?: "Participante"}"
        "ignore" -> "unknown"
        else -> speaker
    }

    fun isOwner(speaker: String) = speaker == "me" || speaker == "me_probable"
    fun name(speaker: String): String = when {
        speaker == "me" -> "Eu"
        speaker == "me_probable" -> "Eu (provável)"
        speaker == "other" -> "Participante"
        speaker.startsWith("named:") -> speaker.removePrefix("named:")
        speaker.startsWith("speaker_") -> speaker.removePrefix("speaker_").toIntOrNull()
            ?.let { "Pessoa ${it + 1}" } ?: "Não identificado"
        else -> "Não identificado"
    }
}
