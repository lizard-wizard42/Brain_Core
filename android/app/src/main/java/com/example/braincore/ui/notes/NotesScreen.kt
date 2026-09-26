package com.example.braincore.ui.notes

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.braincore.BrainCoreApp
import com.example.braincore.data.model.Note
import com.example.braincore.ui.theme.*

data class NoteColorStyle(
    val bg: Color,
    val border: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val badgeBg: Color
)

fun getNoteColorStyle(color: String): NoteColorStyle {
    return when (color.lowercase()) {
        "sand" -> NoteColorStyle(
            bg = Color(0xFFF4EACD),
            border = Color(0xFFE6D3A3),
            textPrimary = Color(0xFF2D2412),
            textSecondary = Color(0xFF5A492A),
            badgeBg = Color(0xFFDCC48A)
        )
        "rose" -> NoteColorStyle(
            bg = Color(0xFFF7DEDE),
            border = Color(0xFFE6A3A3),
            textPrimary = Color(0xFF301717),
            textSecondary = Color(0xFF653737),
            badgeBg = Color(0xFFDC9696)
        )
        "sage" -> NoteColorStyle(
            bg = Color(0xFFE1F1E1),
            border = Color(0xFFA3C7A3),
            textPrimary = Color(0xFF162616),
            textSecondary = Color(0xFF345634),
            badgeBg = Color(0xFF90BA90)
        )
        "sky" -> NoteColorStyle(
            bg = Color(0xFFE0E8F7),
            border = Color(0xFFA3B9E6),
            textPrimary = Color(0xFF142034),
            textSecondary = Color(0xFF334970),
            badgeBg = Color(0xFF92ADE0)
        )
        "amber" -> NoteColorStyle(
            bg = Color(0xFFF7EACF),
            border = Color(0xFFE6C07A),
            textPrimary = Color(0xFF2B1C08),
            textSecondary = Color(0xFF63431A),
            badgeBg = Color(0xFFDCB15E)
        )
        "lavender" -> NoteColorStyle(
            bg = Color(0xFFEEE4F8),
            border = Color(0xFFC3A3E6),
            textPrimary = Color(0xFF21142F),
            textSecondary = Color(0xFF4C3068),
            badgeBg = Color(0xFFB48FE0)
        )
        else -> NoteColorStyle(
            bg = Color(0xFF262626),
            border = Color(0xFF3F3F3F),
            textPrimary = Color(0xFFEDEDED),
            textSecondary = Color(0xFFA8A8A8),
            badgeBg = Color(0xFF404040)
        )
    }
}

@Composable
fun NotesScreen(onOpenPc: () -> Unit = {}) {
    val context = LocalContext.current
    val database = (context.applicationContext as BrainCoreApp).database

    val notes by database.notesFlow.collectAsState()
    var searchInput by remember { mutableStateOf("") }
    var showCreateDialog by remember { mutableStateOf(false) }

    val filteredNotes = remember(notes, searchInput) {
        val q = searchInput.trim().lowercase()
        if (q.isEmpty()) notes
        else notes.filter {
            it.title.lowercase().contains(q) || it.body.lowercase().contains(q)
        }
    }

    Scaffold(
        containerColor = BrainBgDark,
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showCreateDialog = true },
                containerColor = Color(0xFFE6D3A3),
                contentColor = Color(0xFF1C160F),
                shape = CircleShape,
                modifier = Modifier.padding(bottom = 8.dp)
            ) {
                Icon(Icons.Default.Add, contentDescription = "Criar nota", modifier = Modifier.size(28.dp))
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 14.dp)
        ) {
            Spacer(modifier = Modifier.height(14.dp))

            Card(colors = CardDefaults.cardColors(containerColor = BrainSurfaceDark),
                shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("Rascunhos deste aparelho", color = TextPrimary,
                        style = MaterialTheme.typography.titleSmall)
                    Text("Estas notas ainda não sincronizam com o PC. Para ver e editar as notas do Brain Core, use a aba PC.",
                        color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onOpenPc) { Text("Abrir aba PC") }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Barra de busca
            OutlinedTextField(
                value = searchInput,
                onValueChange = { searchInput = it },
                placeholder = { Text("Pesquisar notas...", color = TextSecondary) },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null, tint = TextSecondary)
                },
                trailingIcon = {
                    if (searchInput.isNotEmpty()) {
                        IconButton(onClick = { searchInput = "" }) {
                            Icon(Icons.Default.Close, contentDescription = "Limpar", tint = TextSecondary)
                        }
                    }
                },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    focusedContainerColor = BrainSurfaceDark,
                    unfocusedContainerColor = BrainSurfaceDark,
                    focusedBorderColor = BrainBorderDark,
                    unfocusedBorderColor = BrainBorderDark
                ),
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(14.dp))

            // Contagem de notas
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "${filteredNotes.size} notas",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextSecondary,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Grid infinito estilo Google Keep / Brain Core PC
            if (filteredNotes.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (searchInput.isNotEmpty()) "Nenhuma nota encontrada para '$searchInput'" else "Nenhuma nota ainda.",
                        color = TextMuted,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            } else {
                LazyVerticalStaggeredGrid(
                    columns = StaggeredGridCells.Fixed(2),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalItemSpacing = 10.dp,
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(bottom = 80.dp)
                ) {
                    items(filteredNotes, key = { it.id }) { note ->
                        KeepNoteCard(
                            note = note,
                            onDelete = {
                                database.deleteNote(note.id)
                                Toast.makeText(context, "Nota removida", Toast.LENGTH_SHORT).show()
                            }
                        )
                    }
                }
            }
        }

        if (showCreateDialog) {
            CreateNoteDialog(
                onDismiss = { showCreateDialog = false },
                onConfirm = { title, body, color ->
                    val newNote = Note(
                        title = title,
                        body = body,
                        color = color,
                        tags = listOf("#manual")
                    )
                    database.insertNote(newNote)
                    showCreateDialog = false
                    Toast.makeText(context, "Nota salva!", Toast.LENGTH_SHORT).show()
                }
            )
        }
    }
}

@Composable
fun KeepNoteCard(
    note: Note,
    onDelete: () -> Unit
) {
    val style = getNoteColorStyle(note.color)

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = style.bg),
        border = CardDefaults.outlinedCardBorder().copy(
            brush = androidx.compose.ui.graphics.SolidColor(style.border)
        )
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                if (note.title.isNotEmpty()) {
                    Text(
                        text = note.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = style.textPrimary,
                        modifier = Modifier.weight(1f)
                    )
                }
                IconButton(
                    onClick = onDelete,
                    modifier = Modifier.size(24.dp)
                ) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Excluir",
                        tint = style.textSecondary.copy(alpha = 0.5f),
                        modifier = Modifier.size(16.dp)
                    )
                }
            }

            if (note.body.isNotEmpty()) {
                if (note.title.isNotEmpty()) Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = note.body,
                    style = MaterialTheme.typography.bodySmall,
                    color = style.textSecondary,
                    lineHeight = 18.sp,
                    fontSize = 13.sp
                )
            }

            if (note.reminderDate != null) {
                Spacer(modifier = Modifier.height(10.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = style.badgeBg.copy(alpha = 0.5f)
                ) {
                    Text(
                        text = "🔔 ${note.reminderDate}",
                        style = MaterialTheme.typography.labelSmall,
                        color = style.textPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun CreateNoteDialog(
    onDismiss: () -> Unit,
    onConfirm: (title: String, body: String, color: String) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    var selectedColor by remember { mutableStateOf("sand") }

    val colors = listOf("sand", "rose", "sage", "sky", "amber", "lavender", "slate")

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BrainSurfaceDark,
        title = {
            Text("Criar Nota", color = TextPrimary, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Título") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedBorderColor = BrainBlue,
                        unfocusedBorderColor = BrainBorderDark
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("Conteúdo da nota...") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedBorderColor = BrainBlue,
                        unfocusedBorderColor = BrainBorderDark
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(130.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    colors.forEach { c ->
                        val style = getNoteColorStyle(c)
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(style.bg)
                                .border(
                                    width = if (selectedColor == c) 2.dp else 1.dp,
                                    color = if (selectedColor == c) BrainBlue else style.border,
                                    shape = CircleShape
                                )
                                .clickable { selectedColor = c }
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (title.isNotBlank() || body.isNotBlank()) {
                        onConfirm(title.trim(), body.trim(), selectedColor)
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = BrainBlue),
                enabled = title.isNotBlank() || body.isNotBlank()
            ) {
                Text("Salvar")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancelar", color = TextSecondary)
            }
        }
    )
}
