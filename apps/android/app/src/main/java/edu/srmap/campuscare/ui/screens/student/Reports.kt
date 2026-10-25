package edu.srmap.campuscare.ui.screens.student

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Forum
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Title
import androidx.compose.material.icons.rounded.UploadFile
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.CategorySuggestion
import edu.srmap.campuscare.data.CreatedCase
import edu.srmap.campuscare.data.IncidentDetail
import edu.srmap.campuscare.data.MediaPolicy
import edu.srmap.campuscare.data.newIdempotencyKey
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.Catalog
import edu.srmap.campuscare.ui.components.CategoryInfo
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChatThread
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.Divider
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.ListRow
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.ScreenHeader
import edu.srmap.campuscare.ui.components.ScrollPane
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.ShieldMark
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.TurnstileHost
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.components.rememberLocationRequest
import edu.srmap.campuscare.ui.components.rememberTurnstile
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.screens.common.CaseChatSource
import edu.srmap.campuscare.ui.screens.common.CaseHeaderCard
import edu.srmap.campuscare.ui.screens.common.CaseTimeline
import edu.srmap.campuscare.ui.screens.common.EvidenceList
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fix
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.LocationHelper
import edu.srmap.campuscare.util.readPicked
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val STEPS = listOf("Category", "Details", "Evidence & privacy", "Review")

/**
 * Report an Incident (mockup): a four-step wizard. An on-device-to-server helper suggests a category
 * from the description, but the student always chooses — the suggestion never decides anything.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportIncidentScreen(initialCategory: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config by app.config.config.collectAsState()
    val settings = config.settings
    val turnstile = rememberTurnstile("incidentSubmit")

    var step by rememberSaveable { mutableIntStateOf(if (initialCategory != null) 1 else 0) }
    var category by rememberSaveable { mutableStateOf(initialCategory) }
    var helperText by rememberSaveable { mutableStateOf("") }
    var suggestion by remember { mutableStateOf<CategorySuggestion?>(null) }
    var suggesting by remember { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var location by rememberSaveable { mutableStateOf("") }
    var dateMillis by rememberSaveable { mutableStateOf(LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()) }
    var severity by rememberSaveable { mutableStateOf("medium") }
    var urgent by rememberSaveable { mutableStateOf(false) }
    var involved by rememberSaveable { mutableStateOf("") }
    var anonymous by rememberSaveable { mutableStateOf(false) }
    var preferred by rememberSaveable { mutableStateOf("in_app") }
    var pin by remember { mutableStateOf<Fix?>(null) }
    val evidence = remember { mutableStateListOf<Attachment>() }
    var uploading by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var submitting by remember { mutableStateOf(false) }
    var created by remember { mutableStateOf<CreatedCase?>(null) }
    var showDate by remember { mutableStateOf(false) }
    val idempotencyKey = rememberSaveable { newIdempotencyKey() }

    val anonymousAllowed = settings.anonymousReportingEnabled && category != null && category in settings.anonymousCategories
    LaunchedEffect(anonymousAllowed) { if (!anonymousAllowed) anonymous = false }

    // Debounced category suggestion while typing in the helper box.
    var suggestJob by remember { mutableStateOf<Job?>(null) }
    fun requestSuggestion(text: String) {
        suggestJob?.cancel()
        if (text.trim().length < 15) {
            suggestion = null
            return
        }
        suggestJob = scope.launch {
            delay(600)
            suggesting = true
            suggestion = runCatching { app.api.incidents.suggest(text.trim()) }.getOrNull()
            suggesting = false
        }
    }

    val requestLocation = rememberLocationRequest { granted ->
        if (granted) scope.launch { pin = LocationHelper.current(context); if (pin == null) snack.show("Couldn't get your location. You can still type it.") }
    }

    val maxBytes = settings.evidenceMaxMb * 1024L * 1024L
    fun uploadUris(uris: List<android.net.Uri>) {
        val room = settings.evidenceMaxFiles - evidence.size
        if (room <= 0) {
            snack.show("You can attach up to ${settings.evidenceMaxFiles} files.")
            return
        }
        scope.launch {
            uploading = true
            for (uri in uris.take(room)) {
                try {
                    val f = readPicked(context, uri, maxBytes)
                    evidence.add(app.api.incidents.uploadEvidence(f.bytes, f.name, f.mime, anonymous))
                } catch (e: ApiException) {
                    snack.show(e.message ?: "Upload failed.", long = true)
                }
            }
            uploading = false
        }
    }
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(5)) { uris -> if (uris.isNotEmpty()) uploadUris(uris) }
    val pickDoc = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) uploadUris(uris) }

    fun validateDetails(): Boolean {
        errors = buildMap {
            if (title.trim().length < 5) put("title", "Add a short title (at least 5 characters)")
            if (description.trim().length < 30) put("description", "Please describe what happened (at least 30 characters)")
            if (location.trim().length < 2) put("location", "Enter where it happened")
        }
        return errors.isEmpty()
    }

    fun submit() {
        val cat = category ?: return
        turnstile.run { token ->
            scope.launch {
                submitting = true
                try {
                    val incidentDate = Instant.ofEpochMilli(dateMillis).atZone(ZoneOffset.UTC).toLocalDate()
                        .let { d -> if (d == LocalDate.now()) Instant.now() else d.atTime(12, 0).atZone(ZoneId.systemDefault()).toInstant() }
                    created = app.api.incidents.create(
                        mapOf(
                            "category" to cat, "title" to title.trim(), "description" to description.trim(),
                            "incidentDate" to incidentDate.toString(), "location" to location.trim(), "severity" to severity,
                            "urgent" to urgent, "anonymous" to anonymous, "involvedParties" to involved.trim().ifBlank { null },
                            "preferredContact" to if (anonymous) "in_app" else preferred,
                            "latitude" to pin?.latitude, "longitude" to pin?.longitude,
                            "suggestedCategory" to suggestion?.category,
                            "evidenceIds" to evidence.map { it.id },
                            "idempotencyKey" to idempotencyKey, "turnstileToken" to token,
                        ).filterValues { it != null },
                    )
                } catch (e: ApiException) {
                    if (e.fields.isNotEmpty()) {
                        errors = e.fields
                        step = if (e.fields.keys.any { it in setOf("title", "description", "location", "incidentDate") }) 1 else step
                    }
                    snack.error(e)
                } finally {
                    submitting = false
                }
            }
        }
    }

    created?.let { c ->
        ReportSubmitted(c, anonymous)
        return
    }

    CcScreen(
        title = "Report an Incident",
        subtitle = "Your report is confidential",
        onBack = { if (step > 0) step-- else nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                if (step > 0) CcButton("Back", { step-- }, Modifier.weight(1f), kind = ButtonKind.Outline, leadingIcon = Icons.AutoMirrored.Rounded.ArrowBack)
                when (step) {
                    0 -> CcButton("Next", { step = 1 }, Modifier.weight(1f), enabled = category != null, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
                    1 -> CcButton("Next", { if (validateDetails()) step = 2 }, Modifier.weight(1f), trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
                    2 -> CcButton("Review", { step = 3 }, Modifier.weight(1f), enabled = !uploading, trailingIcon = Icons.AutoMirrored.Rounded.ArrowForward)
                    else -> CcButton("Submit report", { submit() }, Modifier.weight(1f), loading = submitting, kind = ButtonKind.Brand)
                }
            }
        },
    ) {
        StepProgress(step)
        AnimatedContent(
            targetState = step,
            transitionSpec = {
                val dir = if (targetState > initialState) 1 else -1
                (slideInHorizontally(tween(260)) { it / 4 * dir } + fadeIn(tween(260))) togetherWith (slideOutHorizontally(tween(200)) { -it / 4 * dir } + fadeOut(tween(160)))
            },
            label = "wizard",
        ) { s ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (s) {
                    0 -> {
                        CcCard(color = CcColors.Mint50) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.AutoAwesome, contentDescription = null, tint = CcColors.Emerald)
                                Spacer(Modifier.width(8.dp))
                                Text("Not sure which category?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            }
                            CcTextField(helperText, { helperText = it; requestSuggestion(it) }, label = "Describe it in a sentence", singleLine = false, minLines = 2, maxLength = 1000, modifier = Modifier.padding(top = 8.dp))
                            if (suggesting) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 6.dp), color = CcColors.Emerald, trackColor = CcColors.Mint)
                            suggestion?.let { sg -> SuggestionBox(sg, onUse = { category = sg.category; if (description.isBlank()) description = helperText }) }
                        }
                        Text("What happened?", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                        Catalog.categories.chunked(2).forEachIndexed { r, pair ->
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                pair.forEachIndexed { i, c -> CategoryCard(c, c.key == category, { category = c.key }, Modifier.weight(1f).enterStagger(r * 2 + i)) }
                                if (pair.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                    1 -> {
                        category?.let { val c = Catalog.category(it); ListRow(c.label, subtitle = "Category · tap to change", icon = c.icon, tone = c.tone, onClick = { step = 0 }) }
                        CcTextField(title, { title = it; errors = errors - "title" }, label = "Title", placeholder = "e.g. Verbal harassment near library", leadingIcon = Icons.Rounded.Title, error = errors["title"], maxLength = 140, capitalization = KeyboardCapitalization.Sentences)
                        CcTextField(description, { description = it; errors = errors - "description" }, label = "Describe what happened", leadingIcon = Icons.Rounded.Description, error = errors["description"], singleLine = false, minLines = 5, maxLength = 5000, hint = "${description.trim().length}/30 characters minimum", capitalization = KeyboardCapitalization.Sentences)
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White).border(1.dp, CcColors.Line, RoundedCornerShape(16.dp))
                                .clickable(role = Role.Button) { showDate = true }.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Rounded.CalendarMonth, contentDescription = null, tint = CcColors.Forest)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Date of incident", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                                Text(Fmt.date(Instant.ofEpochMilli(dateMillis).toString()), style = MaterialTheme.typography.bodyLarge, color = CcColors.Ink)
                            }
                            Text("Change", color = CcColors.Emerald, fontWeight = FontWeight.SemiBold)
                        }
                        CcTextField(location, { location = it; errors = errors - "location" }, label = "Where did it happen?", placeholder = "e.g. Block C, 2nd floor corridor", leadingIcon = Icons.Rounded.Place, error = errors["location"], maxLength = 200)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (pin != null) "Map pin added (private; used only in anonymised safety heatmaps)" else "Optionally add your current location as a private map pin.",
                                style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, modifier = Modifier.weight(1f),
                            )
                            if (pin == null) TextButton(onClick = { if (LocationHelper.hasPermission(context)) scope.launch { pin = LocationHelper.current(context) } else requestLocation() }) {
                                Icon(Icons.Rounded.MyLocation, contentDescription = null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Add pin")
                            } else IconButton(onClick = { pin = null }) { Icon(Icons.Rounded.Close, contentDescription = "Remove map pin") }
                        }
                        Text("How serious is it?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                        ChoiceChips(listOf("low" to "Low", "medium" to "Medium", "high" to "High", "critical" to "Critical"), severity, { severity = it })
                        SwitchRow("This needs urgent attention", urgent, { urgent = it }, description = "Flags the case for faster review. For danger right now, use SOS.")
                        CcTextField(involved, { involved = it }, label = "People involved (optional)", placeholder = "Names, descriptions or roles", singleLine = false, minLines = 2, maxLength = 1000)
                    }
                    2 -> {
                        Text("Evidence (optional)", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                        Text("Photos, videos or documents up to ${settings.evidenceMaxMb} MB each, max ${settings.evidenceMaxFiles}. A fingerprint (SHA-256) is recorded so the file can be shown to be unchanged.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            CcButton("Photo / video", { pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.AddPhotoAlternate, enabled = !uploading)
                            CcButton("Document", { pickDoc.launch(arrayOf("application/pdf", "image/*", "video/*")) }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.UploadFile, enabled = !uploading)
                        }
                        if (uploading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = CcColors.Emerald, trackColor = CcColors.Mint)
                        evidence.forEach { a ->
                            CcCard(padding = 10.dp) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    IconBadge(Icons.Rounded.UploadFile, Tone.Brand, size = 36.dp, iconSize = 18.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(a.name, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, maxLines = 1)
                                        Text(Fmt.bytes(a.sizeBytes) + (a.sha256?.let { " · ${it.take(10)}…" } ?: ""), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                                    }
                                    IconButton(onClick = { evidence.remove(a) }) { Icon(Icons.Rounded.Close, contentDescription = "Remove ${a.name}") }
                                }
                            }
                        }
                        Divider(Modifier.padding(vertical = 6.dp))
                        Text("Privacy", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                        if (anonymousAllowed) {
                            SwitchRow(
                                "Report anonymously", anonymous, { anonymous = it },
                                description = "Handlers won't see your name. You can still follow the case and chat here. Anonymous reports can be harder to act on.",
                            )
                        } else {
                            InfoBanner(
                                if (!settings.anonymousReportingEnabled) "Anonymous reporting is turned off by the university." else "University policy requires named reports for this category. Only the assigned committee can see your identity.",
                                tone = Tone.Neutral, icon = Icons.Rounded.Lock,
                            )
                        }
                        if (!anonymous) {
                            Text("How should the committee contact you?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            ChoiceChips(listOf("in_app" to "In-app chat", "email" to "Email", "phone" to "Phone"), preferred, { preferred = it })
                        }
                    }
                    else -> {
                        val c = Catalog.category(category ?: "other")
                        CcCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                IconBadge(c.icon, c.tone)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(c.label, style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                                    Text(title, style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
                                }
                            }
                            KeyValue("What happened", description)
                            KeyValue("When", Fmt.date(Instant.ofEpochMilli(dateMillis).toString()))
                            KeyValue("Where", location + if (pin != null) " (private map pin added)" else "")
                            KeyValue("Severity", Fmt.humanize(severity) + if (urgent) " · urgent" else "")
                            KeyValue("People involved", involved)
                            KeyValue("Evidence", if (evidence.isEmpty()) "None" else "${evidence.size} file(s)")
                            KeyValue("Identity", if (anonymous) "Anonymous" else "Named — visible only to the assigned committee")
                        }
                        InfoBanner("After submitting you can track progress, chat with the committee, withdraw the report, or ask to reopen it after it is resolved.", tone = Tone.Sky)
                        TurnstileNoteInline(turnstile.enabled)
                    }
                }
            }
        }
    }
    TurnstileHost(turnstile)

    if (showDate) {
        val today = LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = dateMillis,
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis <= today
            },
        )
        DatePickerDialog(
            onDismissRequest = { showDate = false },
            confirmButton = { TextButton(onClick = { state.selectedDateMillis?.let { dateMillis = it }; showDate = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { showDate = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
}

@Composable
private fun TurnstileNoteInline(enabled: Boolean) {
    if (enabled) Text("A quick human-verification check runs when you submit.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun StepProgress(step: Int) {
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            STEPS.indices.forEach { i ->
                val fill by animateFloatAsState(if (i <= step) 1f else 0f, tween(300), label = "step")
                Box(Modifier.weight(1f).height(6.dp).clip(CircleShape).background(CcColors.Line)) {
                    Box(Modifier.fillMaxWidth(fill).height(6.dp).background(CcColors.Emerald))
                }
            }
        }
        Text("Step ${step + 1} of ${STEPS.size} · ${STEPS[step]}", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun CategoryCard(c: CategoryInfo, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .clip(shape)
            .background(if (selected) c.tone.bg else Color.White)
            .border(if (selected) 2.dp else 1.dp, if (selected) c.tone.fg else CcColors.Line, shape)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconBadge(c.icon, c.tone, size = 36.dp, iconSize = 20.dp)
            Spacer(Modifier.weight(1f))
            if (selected) Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = c.tone.fg)
        }
        Spacer(Modifier.height(8.dp))
        Text(c.label, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        Text(c.description, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 2)
    }
}

@Composable
private fun SuggestionBox(s: CategorySuggestion, onUse: () -> Unit) {
    val nav = LocalNav.current
    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (s.looksUrgent) {
            InfoBanner("This sounds urgent. If you're in danger now, use Emergency SOS.", tone = Tone.Danger, icon = Icons.Rounded.Warning, action = {
                TextButton(onClick = { nav.navigate(Routes.Sos) }) { Text("Open SOS", color = CcColors.Sos) }
            })
        }
        if (s.showCrisisSupport) {
            InfoBanner("You don't have to handle this alone. A counsellor can talk with you confidentially.", tone = Tone.Violet, icon = Icons.Rounded.Psychology, action = {
                TextButton(onClick = { nav.navigate(Routes.Counselling) }) { Text("Talk to a counsellor") }
            })
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Suggested: ${s.label}", style = MaterialTheme.typography.titleSmall, color = CcColors.Forest)
                Text(s.disclaimer.ifBlank { "Suggestion only — you choose the category." }, style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
            }
            CcButton("Use", onUse, kind = ButtonKind.Soft)
        }
    }
}

@Composable
private fun ReportSubmitted(c: CreatedCase, anonymous: Boolean) {
    val nav = LocalNav.current
    Column(
        Modifier.fillMaxSize().background(CcColors.Cream).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        ShieldMark(84.dp, Modifier.enterStagger(0))
        Spacer(Modifier.height(18.dp))
        Text("Report submitted", style = MaterialTheme.typography.displaySmall, color = CcColors.Ink, textAlign = TextAlign.Center, modifier = Modifier.enterStagger(1))
        Text("Case number", style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft, modifier = Modifier.padding(top = 10.dp))
        Text(c.caseNumber, style = MaterialTheme.typography.headlineMedium, color = CcColors.Forest, fontWeight = FontWeight.Bold)
        Text(
            if (anonymous) "Submitted anonymously. Keep using this app to follow the case — it's the only way the committee can reach you."
            else "The committee will review it. You'll get a notification when the status changes.",
            style = MaterialTheme.typography.bodyMedium, color = CcColors.InkSoft, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 10.dp),
        )
        Spacer(Modifier.height(24.dp))
        CcButton("View my report", { nav.navigate(Routes.reportDetail(c.id)) { popUpTo(Routes.Home) } }, Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        CcButton("Back to home", { nav.navigate(Routes.Home) { popUpTo(Routes.Home) { inclusive = true } } }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline)
    }
}

// ------------------------------------------------------------------ my reports

@Composable
fun MyReportsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    var filter by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var submittedQuery by rememberSaveable { mutableStateOf("") }
    val list = rememberLoad(submittedQuery) { app.api.incidents.list("mine", q = submittedQuery) }
    LaunchedEffect(Unit) { app.realtime.events.collect { e -> if (e.name == "case:updated" || e.name == "notification") list.reload() } }
    val activeStatuses = setOf("submitted", "triage", "assigned", "under_review", "in_progress", "awaiting_information", "escalated", "reopened")

    CcScreen(
        title = "My Reports",
        subtitle = "Track and manage your reports",
        refreshing = list.refreshing, onRefresh = { list.reload() },
        floating = {
            CcButton("New report", { nav.navigate(Routes.report()) }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Description)
        },
    ) {
        CcTextField(query, { query = it; if (it.isBlank()) submittedQuery = "" }, label = "Search by case number or title", leadingIcon = Icons.Rounded.Search, onImeAction = { submittedQuery = query.trim() })
        ChoiceChips(listOf("all" to "All", "active" to "Active", "resolved" to "Resolved", "closed" to "Closed"), filter, { filter = it })
        LoadContent(list, skeleton = { SkeletonList(5) }) { page ->
            val items = page.items.filter {
                when (filter) {
                    "active" -> it.status in activeStatuses
                    "resolved" -> it.status == "resolved"
                    "closed" -> it.status in setOf("closed", "withdrawn", "rejected")
                    else -> true
                }
            }
            if (items.isEmpty()) {
                EmptyState(
                    if (page.items.isEmpty()) "No reports yet" else "Nothing here",
                    message = if (page.items.isEmpty()) "When you report an incident it appears here so you can follow it." else "No reports match this filter.",
                    icon = Icons.Rounded.Description,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items.forEachIndexed { i, r ->
                        val cat = Catalog.category(r.category)
                        CcCard(onClick = { nav.navigate(Routes.reportDetail(r.id)) }, modifier = Modifier.enterStagger(i)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                IconBadge(cat.icon, cat.tone)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(r.title.ifBlank { cat.label }, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, maxLines = 2)
                                    Text("${r.caseNumber} · ${cat.label}", style = MaterialTheme.typography.labelMedium, color = CcColors.InkSoft)
                                }
                                if (r.anonymous) Icon(Icons.Rounded.VisibilityOff, contentDescription = "Anonymous", tint = CcColors.InkFaint, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                StatusChip(r.statusLabel.ifBlank { Catalog.statusLabel(r.status) }, Catalog.statusTone(r.status), dot = true)
                                Spacer(Modifier.weight(1f))
                                Text("Updated ${Fmt.ago(r.updatedAt)}", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ report detail (student)

@Composable
fun ReportDetailScreen(id: String, initialTab: String?) {
    val app = LocalApp.current
    val nav = LocalNav.current
    var tab by rememberSaveable { mutableStateOf(initialTab ?: "status") }
    val detail = rememberLoad(id) { app.api.incidents.detail(id) }
    LaunchedEffect(id) { app.realtime.events.collect { e -> if (e.name == "case:updated" && e.payload.optString("id") == id) detail.reload() } }

    Column(Modifier.fillMaxSize().background(CcColors.Cream)) {
        ScreenHeader(
            title = detail.data?.incident?.caseNumber ?: "Report",
            subtitle = detail.data?.incident?.let { "Report Chat · Case #${it.caseNumber}" },
            onBack = { nav.popBackStack() },
        )
        ChoiceChips(listOf("status" to "Status", "chat" to "Chat", "details" to "Details"), tab, { tab = it }, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        LoadContent(detail, modifier = Modifier.weight(1f)) { d ->
            when (tab) {
                "chat" -> {
                    val media = app.config.config.value.settings.chatMedia["case"] ?: MediaPolicy()
                    val closed = d.incident.status in setOf("closed", "withdrawn", "rejected")
                    val source = remember(d.incident.id) { CaseChatSource(app.api, d.incident.id, media, readOnly = closed) }
                    ChatThread(
                        source, Modifier.fillMaxSize(),
                        privacyNote = "Private between you and the assigned committee." + if (d.incident.anonymous) " Your identity stays hidden." else "",
                        emptyText = "Ask a question or share an update with the committee.",
                    )
                }
                "details" -> ScrollPane {
                    CcCard {
                        KeyValue("Title", d.incident.title)
                        KeyValue("What happened", d.incident.description)
                        KeyValue("When", Fmt.date(d.incident.incidentDate))
                        KeyValue("Where", d.incident.location)
                        KeyValue("People involved", d.incident.involvedParties)
                        KeyValue("Severity", Fmt.humanize(d.incident.severity))
                        KeyValue("Submitted", Fmt.dateTime(d.incident.createdAt))
                        KeyValue("Identity", if (d.incident.anonymous) "Anonymous" else "Named")
                    }
                    EvidenceList(d.incident.evidence) { app.api.incidents.fileUrl(it) }
                }
                else -> StudentStatusPane(d, onChanged = { detail.reload() }, openChat = { tab = "chat" })
            }
        }
    }
}

@Composable
private fun StudentStatusPane(d: IncidentDetail, onChanged: () -> Unit, openChat: () -> Unit) {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var withdrawOpen by remember { mutableStateOf(false) }
    var reopenOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val i = d.incident
    val canWithdraw = i.status in setOf("submitted", "triage", "assigned", "under_review", "awaiting_information")
    val canReopen = i.status == "resolved" || i.status == "closed"

    ScrollPane {
        CaseHeaderCard(i)
        if (i.status == "awaiting_information") {
            InfoBanner("The committee needs more information from you.", tone = Tone.Rose, icon = Icons.Rounded.Forum, action = { TextButton(onClick = openChat) { Text("Open chat") } })
        }
        // Progress through the student-facing stages.
        CcCard {
            Text("Progress", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
            Spacer(Modifier.height(10.dp))
            val stages = Catalog.studentTimeline
            val current = stages.indexOf(
                when (i.status) {
                    "triage" -> "submitted"; "awaiting_information", "escalated", "reopened" -> "in_progress"; else -> i.status
                },
            ).coerceAtLeast(0)
            stages.forEachIndexed { idx, st ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                    val done = idx <= current && i.status !in setOf("withdrawn", "rejected")
                    Box(Modifier.size(22.dp).clip(CircleShape).background(if (done) CcColors.Emerald else CcColors.CreamDeep), contentAlignment = Alignment.Center) {
                        if (done) Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(Catalog.statusLabel(st), style = MaterialTheme.typography.bodyMedium, color = if (done) CcColors.Ink else CcColors.InkFaint, fontWeight = if (idx == current) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
        i.resolutionSummary?.takeIf { it.isNotBlank() }?.let {
            CcCard(color = CcColors.Mint50) {
                Text("Resolution", style = MaterialTheme.typography.titleSmall, color = CcColors.Forest)
                Text(it, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink)
            }
        }
        CcButton("Chat with the committee", openChat, Modifier.fillMaxWidth(), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Forum)
        CaseTimeline(d.timeline.filter { it.studentVisible }, staff = false)
        if (canWithdraw) CcButton("Withdraw report", { withdrawOpen = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Ghost, leadingIcon = Icons.AutoMirrored.Rounded.Undo)
        if (canReopen) CcButton("Ask to reopen", { reopenOpen = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Outline, leadingIcon = Icons.Rounded.Refresh)
    }
    if (withdrawOpen) {
        InputDialog(
            "Withdraw this report?", "The committee will stop working on it. The record is kept, and you can contact them again any time.",
            label = "Why are you withdrawing?", confirmLabel = "Withdraw", destructive = true, loading = busy,
            onDismiss = { withdrawOpen = false },
            onConfirm = { reason ->
                scope.launch {
                    busy = true
                    try {
                        app.api.incidents.withdraw(i.id, reason.trim()); withdrawOpen = false; snack.show("Report withdrawn."); onChanged()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
    if (reopenOpen) {
        InputDialog(
            "Reopen this case?", "Explain what still needs attention. Reopen requests are allowed for a limited time after resolution.",
            label = "What still needs to be addressed?", confirmLabel = "Request reopen", minLength = 10, loading = busy,
            onDismiss = { reopenOpen = false },
            onConfirm = { reason ->
                scope.launch {
                    busy = true
                    try {
                        app.api.incidents.reopen(i.id, reason.trim()); reopenOpen = false; snack.show("Case reopened."); onChanged()
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}
