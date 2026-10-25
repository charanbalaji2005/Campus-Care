package edu.srmap.campuscare.ui.screens.student

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.Quiz
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.QuizResult
import edu.srmap.campuscare.data.TrainingModule
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.ShieldMark
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.shareText
import kotlinx.coroutines.launch

/** Safety awareness modules with short quizzes and verifiable completion certificates. */
@Composable
fun AwarenessScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val list = rememberLoad { app.api.content.training() }
    CcScreen(title = "Safety Awareness", subtitle = "Short modules · earn certificates", onBack = { nav.popBackStack() }, refreshing = list.refreshing, onRefresh = { list.reload() }) {
        LoadContent(list) { modules ->
            val done = modules.count { it.completed }
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CcCard(color = CcColors.SkySoft) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconBadge(Icons.Rounded.School, Tone.Sky, size = 50.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("$done of ${modules.size} completed", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                            Text("Learn how to stay safe and help others.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { if (modules.isEmpty()) 0f else done.toFloat() / modules.size },
                        modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape), color = CcColors.Sky, trackColor = Color.White,
                    )
                }
                if (modules.isEmpty()) EmptyState("No modules yet", message = "Training modules will appear here.", icon = Icons.Rounded.School)
                modules.forEachIndexed { i, m ->
                    CcCard(Modifier.enterStagger(i), onClick = { nav.navigate(Routes.module(m.id)) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconBadge(if (m.completed) Icons.Rounded.EmojiEvents else Icons.AutoMirrored.Rounded.MenuBook, if (m.completed) Tone.Brand else Tone.Sky)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(m.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                                Text(m.summary, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 2)
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 8.dp)) {
                            StatusChip("${m.durationMinutes} min", Tone.Neutral)
                            if (m.questionCount > 0) StatusChip("${m.questionCount} questions", Tone.Neutral)
                            if (m.completed) StatusChip("Completed · ${m.bestScore ?: 0}%", Tone.Brand, dot = true)
                        }
                        m.certificateId?.let { id ->
                            CcButton("View certificate", { nav.navigate(Routes.certificate(id)) }, Modifier.padding(top = 8.dp), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.EmojiEvents)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ModuleScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val module = rememberLoad(id) { app.api.content.module(id) }
    var stage by rememberSaveable { mutableStateOf("read") }
    CcScreen(title = module.data?.title ?: "Module", subtitle = module.data?.let { "${it.durationMinutes} min · pass mark ${it.passPercent}%" }, onBack = { nav.popBackStack() }) {
        LoadContent(module) { m ->
            AnimatedContent(stage, label = "module") { s ->
                when (s) {
                    "quiz" -> Quiz(m, onBack = { stage = "read" })
                    else -> Reading(m, onQuiz = { stage = "quiz" })
                }
            }
        }
    }
}

@Composable
private fun Reading(m: TrainingModule, onQuiz: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (m.summary.isNotBlank()) Text(m.summary, style = MaterialTheme.typography.bodyLarge, color = CcColors.InkSoft)
        m.sections.forEachIndexed { i, s ->
            CcCard(Modifier.enterStagger(i)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(28.dp).clip(CircleShape).background(CcColors.Mint), contentAlignment = Alignment.Center) {
                        Text("${i + 1}", color = CcColors.Forest, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(s.heading, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                }
                Text(s.body, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 8.dp))
            }
        }
        if (m.quiz.isNotEmpty()) {
            CcButton("Take the quiz (${m.quiz.size} questions)", onQuiz, Modifier.fillMaxWidth(), kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Quiz)
        }
        if (m.completed) StatusChip("You've completed this module · best ${m.bestScore ?: 0}%", Tone.Brand, dot = true)
    }
}

@Composable
private fun Quiz(m: TrainingModule, onBack: () -> Unit) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val answers = remember { mutableStateListOf<Int?>().apply { repeat(m.quiz.size) { add(null) } } }
    var result by remember { mutableStateOf<QuizResult?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        result?.let { r ->
            CcCard(color = if (r.passed) CcColors.Mint50 else CcColors.AmberSoft) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(if (r.passed) Icons.Rounded.EmojiEvents else Icons.Rounded.Replay, contentDescription = null, tint = if (r.passed) CcColors.Emerald else CcColors.Amber, modifier = Modifier.size(48.dp))
                    Text("${r.score}%", style = MaterialTheme.typography.displaySmall, color = CcColors.Ink)
                    Text(if (r.passed) "Passed — ${r.correct} of ${r.total} correct" else "${r.correct} of ${r.total} correct. You need ${m.passPercent}% to pass.", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(10.dp))
                    r.certificateId?.let { id -> CcButton("View certificate", { nav.navigate(Routes.certificate(id)) }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.EmojiEvents) }
                    if (!r.passed) CcButton("Try again", { result = null; answers.indices.forEach { answers[it] = null } }, kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Replay)
                }
            }
        }
        m.quiz.forEachIndexed { qi, q ->
            val graded = result?.results?.getOrNull(qi)
            CcCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Q${qi + 1}. ${q.question}", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                    graded?.let { Icon(if (it.correct) Icons.Rounded.CheckCircle else Icons.Rounded.Close, contentDescription = if (it.correct) "Correct" else "Incorrect", tint = if (it.correct) CcColors.Emerald else CcColors.Sos) }
                }
                Spacer(Modifier.height(8.dp))
                q.options.forEachIndexed { oi, opt ->
                    val on = answers[qi] == oi
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(12.dp))
                            .background(if (on) CcColors.Mint else Color.White)
                            .border(1.dp, if (on) CcColors.Emerald else CcColors.Line, RoundedCornerShape(12.dp))
                            .clickable(enabled = result == null, role = Role.RadioButton) { answers[qi] = oi }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(18.dp).clip(CircleShape).background(if (on) CcColors.Emerald else CcColors.Line))
                        Spacer(Modifier.width(10.dp))
                        Text(opt, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
                    }
                }
            }
        }
        if (result == null) {
            CcButton(
                "Submit answers",
                {
                    scope.launch {
                        busy = true
                        try {
                            result = app.api.content.attempt(m.id, answers.map { it ?: 0 })
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                },
                Modifier.fillMaxWidth(), enabled = answers.all { it != null }, loading = busy, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward,
            )
            CcButton("Back to reading", onBack, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost)
        }
    }
}

@Composable
fun CertificateScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val cert = rememberLoad(id) { app.api.content.certificate(id) }
    CcScreen(title = "Certificate", onBack = { nav.popBackStack() }) {
        LoadContent(cert) { c ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
                        .background(Brush.linearGradient(listOf(CcColors.Mint50, Color.White, CcColors.AmberSoft)))
                        .border(2.dp, CcColors.Forest.copy(alpha = 0.4f), RoundedCornerShape(24.dp)).padding(24.dp),
                ) {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        ShieldMark(56.dp)
                        Spacer(Modifier.height(8.dp))
                        Text("Certificate of Completion", style = MaterialTheme.typography.headlineSmall, color = CcColors.Forest, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(14.dp))
                        Text("This certifies that", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft)
                        Text(c.holder, style = MaterialTheme.typography.displaySmall, color = CcColors.Ink, textAlign = TextAlign.Center)
                        Text("completed", style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp))
                        Text(c.module, style = MaterialTheme.typography.titleLarge, color = CcColors.Ink, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusChip("Score ${c.score}%", Tone.Brand)
                            StatusChip(Fmt.date(c.completedAt), Tone.Neutral, dot = false)
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Fingerprint, contentDescription = null, tint = CcColors.InkFaint, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("ID ${c.certificateId}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, fontFamily = FontFamily.Monospace)
                        }
                    }
                }
                CcButton(
                    "Share", {
                        context.shareText("CampusCare certificate", "${c.holder} completed \"${c.module}\" on CampusCare (${Fmt.date(c.completedAt)}). Certificate ID: ${c.certificateId}")
                    },
                    Modifier.fillMaxWidth(), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Share,
                )
                Text("Anyone with the certificate ID can ask the university to verify it.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}
