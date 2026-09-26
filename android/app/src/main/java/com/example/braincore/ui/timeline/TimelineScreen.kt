package com.example.braincore.ui.timeline

import android.Manifest
import android.content.pm.PackageManager
import java.io.File
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.example.braincore.BrainCoreApp
import com.example.braincore.data.MobileCredentials
import com.example.braincore.data.MobileApi
import com.example.braincore.data.model.Turn
import com.example.braincore.data.model.Session
import com.example.braincore.data.model.todayIso
import com.example.braincore.service.AudioRecordingService
import com.example.braincore.ui.theme.*
import java.text.SimpleDateFormat
import java.util.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun TimelineScreen() {
    val context = LocalContext.current
    val database = (context.applicationContext as BrainCoreApp).database

    var selectedDate by remember { mutableStateOf(todayIso()) }
    val isRecording by AudioRecordingService.isRecording.collectAsState()
    val recordingError by AudioRecordingService.error.collectAsState()
    val playback = remember { AudioPlaybackController() }
    val scope = rememberCoroutineScope()
    var savingSessionId by remember { mutableStateOf<String?>(null) }
    var playingSessionId by remember { mutableStateOf<String?>(null) }
    DisposableEffect(playback) { onDispose { playback.stop() } }

    // Observa sessões do banco para a data selecionada
    val allSessions by database.sessionsFlow.collectAsState()
    val dailySessions = remember(allSessions, selectedDate) {
        database.getSessionsForDate(selectedDate)
    }

    Scaffold(
        containerColor = BrainBgDark
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp)
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // Cabeçalho da Linha do Tempo
            Text(
                text = "MEMÓRIA CRONOLÓGICA",
                style = MaterialTheme.typography.labelSmall,
                color = BrainBlueLight.copy(alpha = 0.8f),
                letterSpacing = 2.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Linha do Tempo",
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Seletor de Data
            DateNavigator(
                currentDate = selectedDate,
                onDateSelected = { selectedDate = it }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Card do Gravador On-Device
            RecordingControlCard(
                isRecording = isRecording,
                error = recordingError,
                onToggle = {
                    if (isRecording) {
                        AudioRecordingService.stop(context)
                    } else {
                        if (MobileCredentials.recordingOwnerUserId(context) == null) {
                            Toast.makeText(context, "Vincule o aparelho à sua conta em Ajustes antes de gravar.", Toast.LENGTH_LONG).show()
                        } else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            selectedDate = todayIso()
                            AudioRecordingService.start(context)
                        } else {
                            Toast.makeText(context, "Autorize o microfone nos ajustes do Android", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Lista de Sessões (Mais recentes no topo)
            if (dailySessions.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (isRecording) "Gravando neste celular. O áudio aparecerá aqui após você tocar em Parar." else "Nenhuma gravação registrada nesta data.",
                        color = TextMuted,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(dailySessions, key = { it.id }) { session ->
                        SessionCard(
                            session = session,
                            isPlaying = playingSessionId == session.id,
                            isSavingNote = savingSessionId == session.id,
                            onTogglePlayback = {
                                if (playingSessionId == session.id) {
                                    playback.stop()
                                    playingSessionId = null
                                } else {
                                    try {
                                        val files = session.chunks
                                            .filter { it.status == "recorded" }
                                            .map { File(it.path) }
                                            .ifEmpty { listOf(File(requireNotNull(session.audioFilePath))) }
                                        playingSessionId = session.id
                                        playback.play(
                                            files,
                                            onFinished = { playingSessionId = null },
                                            onFailed = {
                                                playingSessionId = null
                                                Toast.makeText(context, "Áudio indisponível", Toast.LENGTH_SHORT).show()
                                            }
                                        )
                                    } catch (_: Exception) {
                                        playingSessionId = null
                                        Toast.makeText(context, "Áudio indisponível", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            onCreateNote = { isReminder ->
                                if (savingSessionId == null) {
                                    savingSessionId = session.id
                                    scope.launch {
                                        try {
                                            withContext(Dispatchers.IO) {
                                                MobileApi(context).createNote(
                                                    "Gravação ${session.formattedTimeRange()}",
                                                    session.text,
                                                    if (isReminder) todayIso() else null
                                                )
                                            }
                                            Toast.makeText(context, "Salvo nas notas do Brain Core", Toast.LENGTH_SHORT).show()
                                        } catch (_: Exception) {
                                            Toast.makeText(context, "Não foi possível salvar no PC. Tente novamente.", Toast.LENGTH_LONG).show()
                                        } finally {
                                            savingSessionId = null
                                        }
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun DateNavigator(
    currentDate: String,
    onDateSelected: (String) -> Unit
) {
    val sdf = remember { SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()) }
    val displayFormat = remember { SimpleDateFormat("dd 'de' MMMM", Locale.forLanguageTag("pt-BR")) }

    val formattedDisplay = remember(currentDate) {
        try {
            val d = sdf.parse(currentDate)
            if (currentDate == todayIso()) "Hoje (${displayFormat.format(d ?: Date())})"
            else displayFormat.format(d ?: Date())
        } catch (_: Exception) {
            currentDate
        }
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(BrainSurfaceDark)
            .border(1.dp, BrainBorderDark, RoundedCornerShape(16.dp))
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = {
            val cal = Calendar.getInstance().apply {
                time = sdf.parse(currentDate) ?: Date()
                add(Calendar.DAY_OF_YEAR, -1)
            }
            onDateSelected(sdf.format(cal.time))
        }) {
            Icon(Icons.Default.ChevronLeft, contentDescription = "Dia anterior", tint = TextSecondary)
        }

        Text(
            text = formattedDisplay,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary
        )

        IconButton(onClick = {
            val cal = Calendar.getInstance().apply {
                time = sdf.parse(currentDate) ?: Date()
                add(Calendar.DAY_OF_YEAR, 1)
            }
            onDateSelected(sdf.format(cal.time))
        }) {
            Icon(Icons.Default.ChevronRight, contentDescription = "Próximo dia", tint = TextSecondary)
        }
    }
}

@Composable
fun RecordingControlCard(
    isRecording: Boolean,
    error: String?,
    onToggle: () -> Unit
) {
    val transition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = if (isRecording) 1.25f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isRecording) BrainBlueMuted.copy(alpha = 0.4f) else BrainSurfaceDark
        ),
        border = CardDefaults.outlinedCardBorder().copy(
            brush = androidx.compose.ui.graphics.SolidColor(
                if (isRecording) BrainBlue else BrainBorderDark
            )
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .scale(pulseScale)
                            .clip(CircleShape)
                            .background(if (isRecording) BrainRed else BrainGreen)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (isRecording) "Gravando neste celular" else "Gravador do celular pronto",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = if (isRecording) BrainBlueLight else TextSecondary
                    )
                }

                Button(
                    onClick = onToggle,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isRecording) BrainRed else BrainBlue
                    ),
                    shape = RoundedCornerShape(12.dp),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    Icon(
                        imageVector = if (isRecording) Icons.Default.Stop else Icons.Default.Mic,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(text = if (isRecording) "Parar" else "Gravar")
                }
            }

            AnimatedVisibility(visible = !error.isNullOrEmpty()) {
                Column(modifier = Modifier.padding(top = 12.dp)) {
                    Text(
                        text = "GRAVAÇÃO:",
                        style = MaterialTheme.typography.labelSmall,
                        color = BrainBlueLight,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = error.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextPrimary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color.Black.copy(alpha = 0.3f))
                            .padding(8.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun SessionCard(
    session: Session,
    isPlaying: Boolean,
    isSavingNote: Boolean,
    onTogglePlayback: () -> Unit,
    onCreateNote: (isReminder: Boolean) -> Unit
) {
    var visibleTurns by remember(session.id) { mutableIntStateOf(8) }
    var visibleCharacters by remember(session.id) { mutableIntStateOf(2000) }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = BrainCardDark),
        border = CardDefaults.outlinedCardBorder().copy(
            brush = androidx.compose.ui.graphics.SolidColor(BrainBorderDark)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Linha superior: Horário + Duração + Status
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = session.formattedTimeRange(),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "· ${session.formattedDuration()}",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary
                    )
                }

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = BrainSurfaceDark,
                    border = CardDefaults.outlinedCardBorder().copy(
                        brush = androidx.compose.ui.graphics.SolidColor(BrainBorderDark)
                    )
                ) {
                    Text(
                        text = when (session.status) {
                            "recording" -> "Gravando"
                            "recorded" -> "Áudio salvo"
                            "partial" -> "Áudio parcial"
                            "error" -> "Interrompida"
                            else -> "Pronta"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = if (session.status == "recording") BrainAmber else TextSecondary,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            if (session.chunks.isNotEmpty()) {
                val savedChunks = session.chunks.count { it.status == "recorded" }
                val uploadedChunks = session.chunks.count { it.status == "recorded" && it.syncState == "uploaded" }
                val purgedChunks = session.chunks.count { it.status == "purged" }
                val conflicts = session.chunks.count { it.syncState == "conflict" }
                Text(
                    text = "$savedChunks ${if (savedChunks == 1) "bloco salvo" else "blocos salvos"} no aparelho · $uploadedChunks enviados ao PC",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary
                )
                if (conflicts > 0) Text("$conflicts bloco(s) com conflito; áudio local preservado.",
                    style = MaterialTheme.typography.labelSmall, color = BrainAmber)
                if (purgedChunks > 0) Text("$purgedChunks bloco(s) de áudio local limpos; transcrição preservada.",
                    style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                Spacer(modifier = Modifier.height(8.dp))
            }

            if (session.transcriptTotal > 0 && session.transcriptState != "ready") {
                val progress = session.transcriptDone.toFloat() / session.transcriptTotal
                Text("Transcrição no PC: ${session.transcriptDone}/${session.transcriptTotal} blocos · ${(progress * 100).toInt()}%",
                    style = MaterialTheme.typography.labelSmall, color = TextSecondary)
                LinearProgressIndicator(progress = { progress.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp), color = BrainBlue)
                Spacer(Modifier.height(10.dp))
            }

            // Conteúdo transcrito
            if (session.turns.isNotEmpty()) {
                val spokenTurns = session.turns.filter { it.text.isNotBlank() }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    spokenTurns.take(visibleTurns).forEach { turn ->
                        val speakerName = when (turn.speaker) {
                            "me" -> "Você"
                            "other" -> "Participante"
                            else -> "Não identificado"
                        }
                        val speakerColor = when (turn.speaker) {
                            "me" -> BrainBlue
                            "other" -> if (LocalBrainPalette.current.light) Color(0xFF6D28D9) else Color(0xFFB794F4)
                            else -> TextSecondary
                        }
                        Surface(
                            modifier = Modifier.fillMaxWidth(0.94f).align(if (turn.speaker == "me") Alignment.End else Alignment.Start),
                            shape = RoundedCornerShape(14.dp),
                            color = speakerColor.copy(alpha = 0.08f),
                            border = CardDefaults.outlinedCardBorder().copy(
                                brush = androidx.compose.ui.graphics.SolidColor(speakerColor.copy(alpha = 0.22f))
                            )
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier.size(30.dp).clip(CircleShape)
                                            .background(speakerColor.copy(alpha = 0.22f)),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(speakerName.first().toString(), color = speakerColor,
                                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    Text(speakerName, color = speakerColor,
                                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                                }
                                Spacer(Modifier.height(8.dp))
                                Text(turn.text, style = MaterialTheme.typography.bodyMedium, color = TextPrimary)
                                if (turn.remoteSegmentId != null && session.ownerUserId == MobileCredentials.userId(LocalContext.current))
                                    ParticipantControls(session.id, session.ownerUserId, turn)
                                Spacer(Modifier.height(4.dp))
                                if (turn.timestamp > 0L) Text(
                                    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(turn.timestamp)),
                                    modifier = Modifier.align(Alignment.End), style = MaterialTheme.typography.labelSmall,
                                    color = TextSecondary)
                            }
                        }
                    }
                    if (spokenTurns.size > visibleTurns) TextButton(onClick = { visibleTurns += 8 }) {
                        Text("Mostrar mais falas (${spokenTurns.size - visibleTurns} restantes)")
                    }
                }
            } else if (session.text.isNotEmpty()) {
                Column {
                    Text(
                    text = session.text.take(visibleCharacters),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextPrimary
                    )
                    if (session.text.length > visibleCharacters) TextButton(onClick = { visibleCharacters += 2000 }) {
                        Text("Mostrar mais transcrição")
                    }
                }
            } else {
                Text(
                    text = if (session.transcriptState == "ready") "Processamento concluído sem fala detectada."
                           else if (session.transcriptState == "error") "Transcrição falhou no PC. O áudio continua salvo."
                           else if (session.transcriptState == "transcribing") "Na fila de transcrição do PC."
                           else if (session.status == "recorded" || session.status == "partial") "Áudio salvo. Aguardando envio ao PC e transcrição."
                           else if (session.status == "error") "Gravação interrompida ou inválida."
                           else "Sem transcrição.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextMuted
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Ações: Criar Nota / Lembrete
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                if ((session.chunks.any { it.status == "recorded" } || session.audioFilePath != null) && session.status != "recording") {
                    TextButton(onClick = onTogglePlayback) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Text(if (isPlaying) "Parar áudio" else "Ouvir", fontSize = 13.sp)
                    }
                }
                TextButton(onClick = { onCreateNote(false) }, enabled = !isSavingNote) {
                    Text("＋ Nota", color = TextSecondary, fontSize = 13.sp)
                }
                Spacer(modifier = Modifier.width(8.dp))
                TextButton(onClick = { onCreateNote(true) }, enabled = !isSavingNote) {
                    Text("🔔 Lembrete", color = BrainAmber, fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun ParticipantControls(sessionId: String, sessionOwnerId: String?, turn: Turn) {
    val context = LocalContext.current
    val database = (context.applicationContext as BrainCoreApp).database
    val scope = rememberCoroutineScope()
    val owner = MobileCredentials.userId(context)?.takeIf { it == sessionOwnerId } ?: return
    val segmentId = turn.remoteSegmentId ?: return
    var data by remember(turn.participantData) { mutableStateOf(turn.participantData?.let { runCatching { JSONObject(it) }.getOrNull() }) }
    var loading by remember(sessionId, segmentId) { mutableStateOf(false) }
    var offline by remember(sessionId, segmentId) { mutableStateOf(false) }
    var currentFromServer by remember(sessionId, segmentId) { mutableStateOf(false) }
    var correcting by remember(sessionId, segmentId) { mutableStateOf(false) }
    var identities by remember(sessionId, segmentId) { mutableStateOf(JSONArray()) }
    val suggestions = data?.optJSONArray("suggestions")
    val suggestion = suggestions?.optJSONObject(0)
    val decision = data?.optJSONObject("decision")
    val decided = decision != null && decision.optString("action") !in setOf("undo", "null", "")

    fun refresh() {
        if (loading) return
        loading = true
        scope.launch {
            try {
                val fresh = withContext(Dispatchers.IO) { MobileApi(context).participantData(sessionId, segmentId, owner) }
                if (MobileCredentials.userId(context) != owner) return@launch
                withContext(Dispatchers.IO) { database.saveParticipantData(sessionId, segmentId, owner, fresh) }
                data = fresh
                offline = false
                currentFromServer = true
            } catch (_: Exception) { offline = true }
            finally { loading = false }
        }
    }
    fun decide(action: String, identityId: String? = null) {
        if (loading) return
        loading = true
        scope.launch {
            try {
                val saved = withContext(Dispatchers.IO) { MobileApi(context).decideParticipant(sessionId, segmentId, owner, action, identityId) }
                val confirmed = JSONObject().put("decision", saved)
                    .put("suggestions", data?.optJSONArray("suggestions") ?: JSONArray())
                if (MobileCredentials.userId(context) != owner) return@launch
                withContext(Dispatchers.IO) { database.saveParticipantData(sessionId, segmentId, owner, confirmed) }
                data = confirmed
                try {
                    val fresh = withContext(Dispatchers.IO) { MobileApi(context).participantData(sessionId, segmentId, owner) }
                    if (MobileCredentials.userId(context) != owner) return@launch
                    withContext(Dispatchers.IO) { database.saveParticipantData(sessionId, segmentId, owner, fresh) }
                    data = fresh
                    offline = false
                    currentFromServer = true
                } catch (_: Exception) { offline = true }
            } catch (_: Exception) {
                offline = true
                Toast.makeText(context, "Não foi possível enviar a decisão. Tente novamente.", Toast.LENGTH_LONG).show()
            } finally { loading = false }
        }
    }
    LaunchedEffect(sessionId, segmentId, owner) { refresh() }
    if (suggestion != null || decided || turn.participantCachedAt != null || offline || data == null) {
        Spacer(Modifier.height(6.dp))
        if (decided) Text(
            if (decision?.optString("action") == "ignore") "Sugestão ignorada" else
                "Identificado: ${decision?.optString("display_name")?.takeIf { it.isNotBlank() } ?: suggestion?.optString("display_name") ?: "Participante"}",
            style = MaterialTheme.typography.labelSmall, color = TextSecondary)
        else if (suggestion != null) Text("Parece ser ${suggestion.optString("display_name")}",
            style = MaterialTheme.typography.labelSmall, color = TextSecondary)
        Text(when {
            offline -> "Offline · mostrando cache${turn.participantCachedAt?.let { " de ${SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(it))}" } ?: ""}"
            loading -> "Atualizando participante…"
            currentFromServer -> "Dados atuais do servidor"
            else -> "Informação em cache · toque em Atualizar"
        }, style = MaterialTheme.typography.labelSmall, color = TextMuted)
        Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (!decided && suggestion != null) {
                TextButton(enabled = !loading && !offline, onClick = { decide("confirm", suggestion.optString("identity_id")) }) { Text("Confirmar") }
                TextButton(enabled = !loading && !offline, onClick = { decide("ignore") }) { Text("Ignorar") }
            }
            TextButton(enabled = !loading && !offline, onClick = {
                scope.launch {
                    loading = true
                    try {
                        identities = withContext(Dispatchers.IO) { MobileApi(context).participantIdentities(sessionId, owner) }
                        correcting = true
                    } catch (_: Exception) { offline = true }
                    finally { loading = false }
                }
            }) { Text("Corrigir") }
            if (decided) TextButton(enabled = !loading && !offline, onClick = { decide("undo") }) { Text("Desfazer") }
            if (offline || data == null) TextButton(enabled = !loading, onClick = { refresh() }) { Text("Atualizar") }
        }
    }
    if (correcting) AlertDialog(
        onDismissRequest = { correcting = false }, title = { Text("Corrigir participante") },
        text = { Column {
            for (index in 0 until identities.length()) {
                val identity = identities.optJSONObject(index) ?: continue
                TextButton(onClick = { correcting = false; decide("correct", identity.optString("id")) }) {
                    Text(identity.optString("display_name"))
                }
            }
            if (identities.length() == 0) Text("Nenhum participante cadastrado.")
        } }, confirmButton = { TextButton(onClick = { correcting = false }) { Text("Fechar") } }
    )
}
