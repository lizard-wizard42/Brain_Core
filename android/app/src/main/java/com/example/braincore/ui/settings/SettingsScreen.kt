package com.example.braincore.ui.settings

import androidx.compose.ui.platform.LocalContext
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.braincore.ui.theme.*
import com.example.braincore.data.ServerSettings
import com.example.braincore.data.MobileApi
import com.example.braincore.data.MobileApiException
import com.example.braincore.data.MobileCredentials
import com.example.braincore.data.SyncScheduler
import com.example.braincore.data.SyncPreferences
import com.example.braincore.data.BrainCoreDatabase
import com.example.braincore.data.LocalSyncStats
import com.example.braincore.data.AudioRetention
import com.example.braincore.data.AudioRetentionPreferences
import com.example.braincore.data.AudioRetentionScheduler
import com.example.braincore.data.AudioCleanupCandidate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

@Composable
fun SettingsScreen(
    onServerUrlSaved: (String) -> Unit = {},
    onOpenAccount: () -> Unit = {}
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pcAddress by remember { mutableStateOf(ServerSettings.get(context)) }
    var savedOrigin by remember { mutableStateOf(ServerSettings.get(context)) }
    var connectionMessage by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var linked by remember { mutableStateOf(MobileCredentials.get(context) != null) }
    var linking by remember { mutableStateOf(false) }
    var linkMessage by remember { mutableStateOf("") }
    var syncMessage by remember { mutableStateOf("") }
    var autoUpload by remember { mutableStateOf(SyncPreferences.autoUpload(context)) }
    var autoTranscribe by remember { mutableStateOf(SyncPreferences.autoTranscribe(context)) }
    var unmeteredOnly by remember { mutableStateOf(SyncPreferences.unmeteredOnly(context)) }
    var localStats by remember { mutableStateOf<LocalSyncStats?>(null) }
    var claimableCount by remember { mutableIntStateOf(0) }
    var showClaimDialog by remember { mutableStateOf(false) }
    var automaticCleanup by remember { mutableStateOf(AudioRetentionPreferences.automatic(context)) }
    var retentionDays by remember { mutableIntStateOf(AudioRetentionPreferences.days(context)) }
    var cleanupCandidates by remember { mutableStateOf<List<AudioCleanupCandidate>>(emptyList()) }
    var cleanupMessage by remember { mutableStateOf("") }
    var checkingCleanup by remember { mutableStateOf(false) }
    var showCleanupDialog by remember { mutableStateOf(false) }
    var pcAutomatic by remember { mutableStateOf(false) }
    var pcRetentionDays by remember { mutableIntStateOf(90) }
    var pcEligibleFiles by remember { mutableIntStateOf(0) }
    var pcEligibleBytes by remember { mutableLongStateOf(0L) }
    var pcCleanupMessage by remember { mutableStateOf("") }
    var pcBusy by remember { mutableStateOf(false) }
    var showPcCleanupDialog by remember { mutableStateOf(false) }
    var transcriptionMode by remember { mutableStateOf("automatic") }
    var transcriptionStart by remember { mutableStateOf("22:00") }
    var transcriptionWindow by remember { mutableIntStateOf(8) }
    var manualTranscriptionActive by remember { mutableStateOf(false) }
    var transcriptionPaused by remember { mutableStateOf(false) }
    var transcriptionBusy by remember { mutableStateOf(false) }
    var transcriptionMessage by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        val database = BrainCoreDatabase.getInstance(context)
        val token = MobileCredentials.get(context)
        if (token != null && MobileCredentials.userId(context) == null) {
            val restored = withContext(Dispatchers.IO) {
                try {
                    MobileCredentials.bindExistingUserId(context, token, MobileApi(context).resolveLinkedUserId())
                } catch (_: Exception) { false }
            }
            if (restored) database.refreshAll()
            else linkMessage = "Não foi possível identificar a conta vinculada. Verifique a conexão com o PC."
        }
        localStats = withContext(Dispatchers.IO) { database.getLocalSyncStats() }
        claimableCount = withContext(Dispatchers.IO) { database.claimableUnownedSessionCount() }
        cleanupCandidates = withContext(Dispatchers.IO) { AudioRetention.eligible(context, retentionDays) }
    }

    LaunchedEffect(retentionDays) {
        cleanupCandidates = withContext(Dispatchers.IO) { AudioRetention.eligible(context, retentionDays) }
    }
    LaunchedEffect(linked) {
        if (linked) {
            try {
                val policy = withContext(Dispatchers.IO) { MobileApi(context).pcAudioRetention() }
                pcAutomatic = policy.optBoolean("automatic")
                pcRetentionDays = policy.optInt("days", 90)
            } catch (_: Exception) { pcCleanupMessage = "Política do PC indisponível. Confira a conexão." }
        }
    }
    LaunchedEffect(linked) {
        if (linked) {
            try {
                val policy = withContext(Dispatchers.IO) { MobileApi(context).transcriptionPolicy() }
                transcriptionMode = policy.optString("mode", "automatic")
                transcriptionStart = policy.optString("start_time", "22:00")
                transcriptionWindow = policy.optInt("window_hours", 8)
                manualTranscriptionActive = policy.optInt("manual_active") != 0
                transcriptionPaused = policy.optInt("paused") != 0
            } catch (_: Exception) { transcriptionMessage = "Fila do PC indisponível." }
        }
    }
    LaunchedEffect(linked, pcRetentionDays) {
        if (linked) {
            try {
                val preview = withContext(Dispatchers.IO) { MobileApi(context).pcAudioCleanupPreview(pcRetentionDays) }
                pcEligibleFiles = preview.optInt("files")
                pcEligibleBytes = preview.optLong("bytes")
            } catch (_: Exception) { pcEligibleFiles = 0; pcEligibleBytes = 0L }
        }
    }

    Scaffold(
        containerColor = BrainBgDark
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "CONFIGURAÇÕES DO SISTEMA",
                style = MaterialTheme.typography.labelSmall,
                color = BrainBlueLight.copy(alpha = 0.8f),
                letterSpacing = 2.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Ajustes & Status",
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Card Status 100% Android
            InfoCard(
                icon = Icons.Default.CheckCircle,
                iconColor = BrainGreen,
                title = "Gravação local",
                subtitle = "O áudio gravado fica neste aparelho até a sincronização. As notas em Conhecimento ficam no Brain Core do PC."
            )

            Spacer(modifier = Modifier.height(12.dp))

            InfoCard(
                icon = Icons.Default.Mic,
                iconColor = BrainBlue,
                title = "Transcrição",
                subtitle = "Depois da vinculação, o PC recebe os blocos e transcreve conforme a política escolhida abaixo."
            )

            Spacer(modifier = Modifier.height(12.dp))

            InfoCard(
                icon = Icons.Default.Storage,
                iconColor = BrainAmber,
                title = "Banco Local (SQLite)",
                subtitle = "Sessões e blocos de áudio são registrados no banco local. O áudio é salvo em arquivos privados do app."
            )

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = "ACESSO AO BRAIN CORE NO PC",
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary,
                letterSpacing = 1.sp,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(10.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark),
                border = CardDefaults.outlinedCardBorder().copy(
                    brush = androidx.compose.ui.graphics.SolidColor(BrainBorderDark)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Endereço HTTPS do Tailscale",
                        style = MaterialTheme.typography.titleSmall,
                        color = TextPrimary,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Conhecimento e Notas usam o servidor HTTPS do Brain Core configurado abaixo.",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary,
                        modifier = Modifier.padding(top = 4.dp, bottom = 12.dp)
                    )

                    OutlinedTextField(
                        value = pcAddress,
                        onValueChange = { pcAddress = it; connectionMessage = "" },
                        singleLine = true,
                        placeholder = { Text("https://brain.example.org") },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = BrainBlue,
                            unfocusedBorderColor = BrainBorderDark
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = {
                            val origin = ServerSettings.normalize(pcAddress)
                            if (origin == null) connectionMessage = "Use a origem HTTPS do seu servidor, sem caminho ou parâmetros."
                            else if (linked && savedOrigin.isNotBlank() && savedOrigin != origin) {
                                connectionMessage = "Desvincule este aparelho antes de trocar o PC."
                            } else {
                                ServerSettings.save(context, origin)
                                pcAddress = origin
                                savedOrigin = origin
                                connectionMessage = "Endereço salvo."
                                onServerUrlSaved(origin)
                            }
                        },
                        enabled = pcAddress.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = BrainBlue),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Salvar endereço")
                    }

                    if (savedOrigin.isNotBlank()) {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    checking = true
                                    connectionMessage = withContext(Dispatchers.IO) {
                                        try {
                                            val connection = URL("$savedOrigin/api/health").openConnection() as HttpURLConnection
                                            connection.connectTimeout = 5000
                                            connection.readTimeout = 5000
                                            try {
                                                if (connection.responseCode == 200) "PC acessível pelo Tailscale."
                                                else "PC respondeu HTTP ${connection.responseCode}."
                                            } finally { connection.disconnect() }
                                        } catch (_: Exception) {
                                            "PC indisponível. Verifique o Tailscale nos dois aparelhos."
                                        }
                                    }
                                    checking = false
                                }
                            },
                            enabled = !checking
                        ) { Text(if (checking) "Verificando…" else "Testar conexão") }
                    }

                    if (connectionMessage.isNotEmpty()) {
                        Text(connectionMessage, color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))
            Text("SINCRONIZAÇÃO DAS GRAVAÇÕES", color = TextSecondary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(10.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(if (linked) "Aparelho vinculado" else "Aparelho ainda não vinculado",
                        color = TextPrimary, style = MaterialTheme.typography.titleSmall)
                    Text("Faça login em Conhecimento uma vez. Depois vincule este aparelho para enviar áudio; a senha e o token da GPU não ficam no Android.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    if (!linked) {
                        Button(onClick = {
                            scope.launch {
                                linking = true
                                linkMessage = withContext(Dispatchers.IO) {
                                    try {
                                        MobileApi(context).linkAfterWebLogin()
                                        BrainCoreDatabase.getInstance(context).refreshAll()
                                        "Vinculado. Gravações desta conta entrarão na fila."
                                    } catch (error: MobileApiException) {
                                        if (error.statusCode == 401) "Faça login em Conhecimento e tente novamente."
                                        else "Vinculação falhou (HTTP ${error.statusCode})."
                                    } catch (_: Exception) { "Não foi possível vincular. Confira a URL e o Tailscale." }
                                }
                                linked = MobileCredentials.get(context) != null
                                claimableCount = withContext(Dispatchers.IO) {
                                    BrainCoreDatabase.getInstance(context).claimableUnownedSessionCount()
                                }
                                if (linked) SyncScheduler.start(context)
                                linking = false
                            }
                        }, enabled = savedOrigin.isNotBlank() && !linking) {
                            Text(if (linking) "Vinculando…" else "Vincular gravações")
                        }
                    } else {
                        Column {
                            TextButton(onClick = {
                                scope.launch {
                                    linking = true
                                    linkMessage = withContext(Dispatchers.IO) {
                                        try {
                                            MobileApi(context).revokeThisDevice()
                                            MobileCredentials.clear(context)
                                            BrainCoreDatabase.getInstance(context).refreshAll()
                                            "Vinculação revogada. Áudios locais preservados."
                                        } catch (_: Exception) { "Não foi possível revogar no PC. Tente novamente online." }
                                    }
                                    linked = MobileCredentials.get(context) != null
                                    if (!linked) SyncScheduler.start(context)
                                    linking = false
                                }
                            }, enabled = !linking) { Text("Desvincular") }
                        }
                    }
                    if (linked && claimableCount > 0) {
                        Spacer(Modifier.height(12.dp))
                        Text("$claimableCount gravação(ões) antiga(s) ainda não têm conta definida. Elas ficam neste aparelho e não são enviadas automaticamente.",
                            color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { showClaimDialog = true }) {
                            Text("Atribuir gravações antigas a esta conta")
                        }
                    }
                    if (linkMessage.isNotBlank()) Text(linkMessage, color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
            Spacer(modifier = Modifier.height(24.dp))

            Text("ENVIO E TRANSCRIÇÃO", color = TextSecondary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    SettingsToggle("Enviar áudio automaticamente",
                        "Gravações novas entram na fila quando o PC estiver acessível.", autoUpload) {
                        autoUpload = it
                        SyncPreferences.setAutoUpload(context, it)
                        SyncScheduler.start(context)
                    }
                    HorizontalDivider(color = BrainBorderDark, modifier = Modifier.padding(vertical = 10.dp))
                    SettingsToggle("Transcrever automaticamente no PC",
                        "Ao terminar o envio, o PC processa a sessão. Desligado: use o botão de transcrição manual.", autoTranscribe) {
                        autoTranscribe = it
                        SyncPreferences.setAutoTranscribe(context, it)
                        if (it && autoUpload) SyncScheduler.runAutomatically(context)
                    }
                    HorizontalDivider(color = BrainBorderDark, modifier = Modifier.padding(vertical = 10.dp))
                    SettingsToggle("Somente rede não tarifada",
                        "Evita envio por rede móvel tarifada. A sincronização espera uma rede não tarifada.", unmeteredOnly) {
                        unmeteredOnly = it
                        SyncPreferences.setUnmeteredOnly(context, it)
                        SyncScheduler.start(context)
                    }
                    Spacer(Modifier.height(12.dp))
                    Text("O modelo e a GPU são configurados no PC. O celular sempre guarda o áudio antes de tentar enviar.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = {
                        SyncScheduler.runNow(context, forceTranscription = false)
                        syncMessage = "Envio solicitado; acompanhe a Linha do Tempo."
                    }, enabled = linked) { Text("Enviar pendentes agora") }
                    TextButton(onClick = {
                        SyncScheduler.runNow(context, forceTranscription = true)
                        syncMessage = "Transcrição solicitada; acompanhe a Linha do Tempo."
                    }, enabled = linked) { Text("Transcrever pendentes agora") }
                    if (syncMessage.isNotBlank()) Text(syncMessage, color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall)
                }
            }

            Spacer(Modifier.height(12.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Quando usar a GPU do PC", color = TextPrimary,
                        style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text("O áudio continua salvo e enviado mesmo se a transcrição estiver pausada. Esta política vale para a sua conta.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("automatic" to "Automático", "scheduled" to "Programado", "manual" to "Só manual").forEach { (mode, label) ->
                            FilterChip(selected = transcriptionMode == mode, onClick = { transcriptionMode = mode }, label = { Text(label) })
                        }
                    }
                    if (transcriptionMode == "scheduled") {
                        OutlinedTextField(value = transcriptionStart, onValueChange = { transcriptionStart = it.take(5) },
                            label = { Text("Início diário (HH:mm, Brasília)") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth())
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf(2, 4, 8, 12).forEach { hours ->
                                FilterChip(selected = transcriptionWindow == hours, onClick = { transcriptionWindow = hours },
                                    label = { Text("${hours}h") })
                            }
                        }
                    }
                    Button(onClick = {
                        scope.launch {
                            transcriptionBusy = true
                            try {
                                val policy = withContext(Dispatchers.IO) { MobileApi(context).saveTranscriptionPolicy(transcriptionMode, transcriptionStart, transcriptionWindow) }
                                manualTranscriptionActive = policy.optInt("manual_active") != 0
                                transcriptionPaused = policy.optInt("paused") != 0
                                transcriptionMessage = "Modo salvo no PC."
                            } catch (_: Exception) { transcriptionMessage = "Confira o horário e a conexão com o PC." }
                            transcriptionBusy = false
                        }
                    }, enabled = linked && !transcriptionBusy) { Text("Salvar modo") }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { scope.launch {
                            transcriptionBusy = true
                            try {
                                val policy = withContext(Dispatchers.IO) { MobileApi(context).runTranscriptionNow() }
                                manualTranscriptionActive = policy.optInt("manual_active") != 0
                                transcriptionPaused = policy.optInt("paused") != 0
                                SyncScheduler.runNow(context, forceTranscription = true)
                                transcriptionMessage = "Fila liberada; veja o progresso na Linha do Tempo."
                            } catch (_: Exception) { transcriptionMessage = "Não foi possível iniciar a fila." }
                            transcriptionBusy = false
                        } }, enabled = linked && !transcriptionBusy && (!manualTranscriptionActive || transcriptionPaused)) { Text("Transcrever agora") }
                        TextButton(onClick = { scope.launch {
                            transcriptionBusy = true
                            try {
                                val policy = withContext(Dispatchers.IO) { MobileApi(context).pauseTranscription() }
                                manualTranscriptionActive = policy.optInt("manual_active") != 0
                                transcriptionPaused = policy.optInt("paused") != 0
                                transcriptionMessage = "Novos blocos pausados; o bloco atual termina."
                            } catch (_: Exception) { transcriptionMessage = "Não foi possível pausar a fila." }
                            transcriptionBusy = false
                        } }, enabled = linked && !transcriptionBusy && !transcriptionPaused) { Text("Pausar") }
                    }
                    if (transcriptionPaused) Text("Fila pausada. Toque em Transcrever agora ou salve o modo para retomar.",
                        color = BrainAmber, style = MaterialTheme.typography.bodySmall)
                    if (transcriptionMessage.isNotBlank()) Text(transcriptionMessage, color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            Text("CONTA E SEGURANÇA", color = TextSecondary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Login, senha, autenticação em duas etapas e dispositivos vinculados usam sua conta no Brain Core. Essas opções precisam de conexão.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onOpenAccount) { Text("Abrir conta e segurança") }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            Text("DADOS E PRIVACIDADE", color = TextSecondary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Neste aparelho", color = TextPrimary, style = MaterialTheme.typography.titleSmall)
                    val stats = localStats
                    Text(if (stats == null) "Calculando armazenamento…" else
                        "${stats.sessions} sessões · ${stats.chunks} blocos de áudio",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    if (stats != null) {
                        Text("${stats.pendingChunks} pendentes · ${stats.conflictChunks} com conflito · " +
                            "%.1f MiB de áudio".format(stats.audioBytes / 1048576.0),
                            color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    }
                    TextButton(onClick = { scope.launch {
                        localStats = withContext(Dispatchers.IO) {
                            BrainCoreDatabase.getInstance(context).getLocalSyncStats()
                        }
                    } }) { Text("Atualizar contagem") }
                    Text("O áudio fica no armazenamento privado do app. As notas usam a conta no PC e exigem conexão. O backup automático do Android está desativado até existir restauração criptografada testada.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                }
            }

            Spacer(Modifier.height(12.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Limpeza de áudio neste aparelho", color = TextPrimary,
                        style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text("Preserva notas, transcrições e histórico. Só remove áudio local de sessões já enviadas e transcritas no PC. Áudios pendentes, com erro ou conflito ficam protegidos.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(12.dp))
                    SettingsToggle("Limpeza automática", "Executa aproximadamente uma vez por dia; vem desligada.",
                        automaticCleanup) {
                        automaticCleanup = it
                        AudioRetentionPreferences.setAutomatic(context, it)
                        AudioRetentionScheduler.update(context)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text("Remover após", color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.fillMaxWidth()) {
                        AudioRetentionPreferences.allowedDays.forEach { days ->
                            FilterChip(selected = retentionDays == days, onClick = {
                                retentionDays = days
                                AudioRetentionPreferences.setDays(context, days)
                                if (automaticCleanup) AudioRetentionScheduler.update(context)
                            }, label = { Text("${days}d") })
                        }
                    }
                    val candidateBytes = cleanupCandidates.sumOf { it.sizeBytes }
                    Text("Elegíveis: ${cleanupCandidates.size} blocos · %.1f MiB".format(candidateBytes / 1048576.0),
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { showCleanupDialog = true },
                        enabled = cleanupCandidates.isNotEmpty() && !checkingCleanup) {
                        Text("Limpar agora")
                    }
                    if (cleanupMessage.isNotBlank()) Text(cleanupMessage, color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall)
                }
            }

            Spacer(Modifier.height(12.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Limpeza de áudio no PC", color = TextPrimary,
                        style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text("Prazo independente do celular. Só remove áudio de sessões concluídas com todos os blocos transcritos. Texto e histórico continuam disponíveis; o áudio removido não pode ser reprocessado.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(10.dp))
                    SettingsToggle("Limpeza automática no PC", "Executa diariamente; vem desligada.", pcAutomatic) { enabled ->
                        if (linked && !pcBusy) scope.launch {
                            pcBusy = true
                            try {
                                val policy = withContext(Dispatchers.IO) { MobileApi(context).savePcAudioRetention(enabled, pcRetentionDays) }
                                pcAutomatic = policy.optBoolean("automatic")
                                pcCleanupMessage = "Política salva no PC."
                            } catch (_: Exception) { pcCleanupMessage = "Não foi possível salvar no PC." }
                            pcBusy = false
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        listOf(30, 90, 180, 365).forEach { days ->
                            FilterChip(selected = pcRetentionDays == days, onClick = {
                                if (linked && !pcBusy) scope.launch {
                                    pcBusy = true
                                    try {
                                        val policy = withContext(Dispatchers.IO) { MobileApi(context).savePcAudioRetention(pcAutomatic, days) }
                                        pcRetentionDays = policy.optInt("days", days)
                                        pcCleanupMessage = "Prazo salvo no PC."
                                    } catch (_: Exception) { pcCleanupMessage = "Não foi possível salvar o prazo no PC." }
                                    pcBusy = false
                                }
                            }, label = { Text("${days}d") })
                        }
                    }
                    Text("Elegíveis no PC: $pcEligibleFiles blocos · %.1f MiB".format(pcEligibleBytes / 1048576.0),
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { showPcCleanupDialog = true },
                        enabled = linked && !pcBusy && pcEligibleFiles > 0) { Text("Limpar agora no PC") }
                    if (pcCleanupMessage.isNotBlank()) Text(pcCleanupMessage, color = TextSecondary,
                        style = MaterialTheme.typography.bodySmall)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            Text("GRAVAÇÃO E PERMISSÕES", color = TextSecondary,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark)) {
                Column(modifier = Modifier.padding(16.dp)) {
                    val micAllowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                        PackageManager.PERMISSION_GRANTED
                    Text(if (micAllowed) "Microfone autorizado" else "Microfone sem permissão",
                        color = if (micAllowed) BrainGreen else BrainAmber,
                        style = MaterialTheme.typography.titleSmall)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val notificationsAllowed = ContextCompat.checkSelfPermission(context,
                            Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                        Text(if (notificationsAllowed) "Notificações autorizadas" else "Notificações desativadas",
                            color = if (notificationsAllowed) BrainGreen else BrainAmber,
                            style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Gravação local em AAC/M4A, dividida em blocos de cerca de dois minutos. Continua mesmo sem conexão com o PC.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = {
                        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:${context.packageName}")))
                    }) { Text("Abrir permissões do Android") }
                }
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
    if (showClaimDialog) {
        AlertDialog(
            onDismissRequest = { showClaimDialog = false },
            title = { Text("Atribuir gravações antigas") },
            text = { Text("Faça isso apenas se estas $claimableCount gravação(ões) forem suas. Elas serão enviadas para a conta vinculada neste aparelho.") },
            confirmButton = {
                TextButton(onClick = {
                    showClaimDialog = false
                    val owner = MobileCredentials.userId(context) ?: return@TextButton
                    scope.launch {
                        val claimed = withContext(Dispatchers.IO) {
                            BrainCoreDatabase.getInstance(context).claimUnownedSessions(owner)
                        }
                        claimableCount = withContext(Dispatchers.IO) {
                            BrainCoreDatabase.getInstance(context).claimableUnownedSessionCount()
                        }
                        linkMessage = "$claimed gravação(ões) atribuída(s) à conta vinculada."
                        SyncScheduler.start(context)
                    }
                }) { Text("Atribuir") }
            },
            dismissButton = { TextButton(onClick = { showClaimDialog = false }) { Text("Cancelar") } }
        )
    }
    if (showCleanupDialog) {
        AlertDialog(
            onDismissRequest = { showCleanupDialog = false },
            title = { Text("Limpar áudio local?") },
            text = { Text("Serão removidos até ${cleanupCandidates.size} blocos com mais de $retentionDays dias, já enviados e transcritos no PC. Você ainda verá os textos, mas não poderá ouvir esses arquivos neste aparelho.") },
            confirmButton = { TextButton(onClick = {
                showCleanupDialog = false
                checkingCleanup = true
                scope.launch {
                    cleanupMessage = try {
                        val result = withContext(Dispatchers.IO) { AudioRetention.clean(context, retentionDays) }
                        "${result.files} arquivo(s) removido(s); %.1f MiB liberados.".format(result.bytes / 1048576.0)
                    } catch (_: Exception) { "A limpeza falhou. Nenhum áudio pendente foi selecionado." }
                    cleanupCandidates = withContext(Dispatchers.IO) { AudioRetention.eligible(context, retentionDays) }
                    localStats = withContext(Dispatchers.IO) { BrainCoreDatabase.getInstance(context).getLocalSyncStats() }
                    checkingCleanup = false
                }
            }) { Text("Remover áudio") } },
            dismissButton = { TextButton(onClick = { showCleanupDialog = false }) { Text("Cancelar") } }
        )
    }
    if (showPcCleanupDialog) {
        AlertDialog(onDismissRequest = { showPcCleanupDialog = false },
            title = { Text("Remover áudio do PC?") },
            text = { Text("Até $pcEligibleFiles blocos com mais de $pcRetentionDays dias serão removidos. Textos e histórico permanecem, mas esses áudios não poderão ser ouvidos nem reprocessados no PC.") },
            confirmButton = { TextButton(onClick = {
                showPcCleanupDialog = false
                scope.launch {
                    pcBusy = true
                    try {
                        val result = withContext(Dispatchers.IO) { MobileApi(context).cleanPcAudio(pcRetentionDays) }
                        pcCleanupMessage = "${result.optInt("files")} arquivo(s) removido(s); %.1f MiB liberados no PC.".format(result.optLong("bytes") / 1048576.0)
                        val preview = withContext(Dispatchers.IO) { MobileApi(context).pcAudioCleanupPreview(pcRetentionDays) }
                        pcEligibleFiles = preview.optInt("files")
                        pcEligibleBytes = preview.optLong("bytes")
                    } catch (_: Exception) { pcCleanupMessage = "Limpeza do PC falhou. Tente novamente." }
                    pcBusy = false
                }
            }) { Text("Remover do PC") } },
            dismissButton = { TextButton(onClick = { showPcCleanupDialog = false }) { Text("Cancelar") } })
    }
}

@Composable
private fun SettingsToggle(title: String, description: String, checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = TextPrimary, style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold)
            Text(description, color = TextSecondary, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.width(8.dp))
        Switch(checked = checked, onCheckedChange = onChecked)
    }
}

@Composable
fun InfoCard(
    icon: ImageVector,
    iconColor: androidx.compose.ui.graphics.Color,
    title: String,
    subtitle: String
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark),
        border = CardDefaults.outlinedCardBorder().copy(
            brush = androidx.compose.ui.graphics.SolidColor(BrainBorderDark)
        )
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(iconColor.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = iconColor,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    lineHeight = 18.sp
                )
            }
        }
    }
}
