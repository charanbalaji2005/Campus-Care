package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.CounsellorPublicProfile
import edu.srmap.campuscare.data.RatingText
import edu.srmap.campuscare.data.SPECIALIZATION_LABELS
import edu.srmap.campuscare.data.wellness
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

private val MODES = linkedMapOf("in_person" to "In person", "online" to "Online", "phone" to "Phone")

/**
 * The counsellor's public profile, as students see it in Find a Counsellor. Professional details are
 * editable here; qualifications and experience wait for Super Admin approval; listing and photo
 * visibility are decided by a Super Admin. Contact details and records are never part of it.
 */
@Composable
fun CounsellorPublicProfileScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val load = rememberLoad { app.api.wellness.myPublicProfile() }
    var title by rememberSaveable { mutableStateOf("") }
    var bio by rememberSaveable { mutableStateOf("") }
    var specs by rememberSaveable { mutableStateOf(listOf<String>()) }
    var languages by rememberSaveable { mutableStateOf("") }
    var modes by rememberSaveable { mutableStateOf(listOf<String>()) }
    var quals by rememberSaveable { mutableStateOf("") }
    var years by rememberSaveable { mutableStateOf("") }
    var loadedOnce by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    // Fill the form once from the server (pending credentials take precedence over approved ones).
    LaunchedEffect(load.data) {
        val p = load.data?.profile ?: return@LaunchedEffect
        if (loadedOnce) return@LaunchedEffect
        title = p.title
        bio = p.bio
        specs = p.specializations
        languages = p.languages.joinToString(", ")
        modes = p.supportedModes
        quals = (p.pendingCredentials?.qualifications ?: p.qualifications).joinToString("\n")
        years = (p.pendingCredentials?.yearsExperience ?: p.yearsExperience)?.toString() ?: ""
        loadedOnce = true
    }

    val yearsValue = years.trim().takeIf { it.isNotEmpty() }?.toIntOrNull()
    val yearsInvalid = years.isNotBlank() && (yearsValue == null || yearsValue !in 0..60)
    val langList = languages.split(',').map { it.trim() }.filter { it.length >= 2 }.distinct()
    val qualList = quals.lines().map { it.trim() }.filter { it.length >= 2 }.distinct()
    val invalid = title.trim().length < 2 || yearsInvalid || modes.isEmpty() || qualList.size > 10 || langList.size > 12

    CcScreen(
        title = "Public profile", subtitle = "What students see in Find a Counsellor", onBack = { nav.popBackStack() },
        refreshing = load.refreshing, onRefresh = { loadedOnce = false; load.reload() },
        bottomBar = {
            BottomActionBar {
                CcButton("Save profile", {
                    val current = load.data?.profile ?: return@CcButton
                    val shown = current.pendingCredentials?.qualifications ?: current.qualifications
                    val shownYears = current.pendingCredentials?.yearsExperience ?: current.yearsExperience
                    val credentialsChanged = qualList != shown || yearsValue != shownYears
                    scope.launch {
                        busy = true
                        try {
                            val saved = app.api.wellness.saveMyPublicProfile(
                                CounsellorPublicProfile(
                                    title = title.trim(), bio = bio.trim(), specializations = specs, languages = langList, supportedModes = modes,
                                    qualifications = qualList, yearsExperience = yearsValue,
                                ),
                                credentialsChanged,
                            )
                            snack.show(if (saved.credentialsPending) "Saved. Your qualifications were sent for approval." else "Saved. Students see the changes right away.")
                            loadedOnce = false
                            load.reload()
                        } catch (e: ApiException) {
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.weight(1f), loading = busy, enabled = load.data != null && !invalid)
            }
        },
    ) {
        LoadContent(load, skeleton = { SkeletonList(3) }) { view ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val p = view.profile
                if (!p.listed) {
                    InfoBanner(
                        "Students can't find or book you in the directory right now.${p.listingReason?.let { " Reason: $it" } ?: ""} Contact a Super Admin if this is unexpected.",
                        title = "Not listed", icon = Icons.Rounded.VisibilityOff, tone = Tone.Amber,
                    )
                }
                if (!p.photoVisible) InfoBanner("Your photo is hidden on your public profile; students see your initials.", icon = Icons.Rounded.VisibilityOff, tone = Tone.Neutral)
                InfoBanner("Your email, phone, employee ID, student records and session notes are never shown on your public profile.", icon = Icons.Rounded.Lock, tone = Tone.Violet)

                SectionHeader("How students see you")
                CcCard {
                    KeyValue("Feedback", RatingText.summary(view.preview?.rating))
                    if (view.preview?.rating?.isAvailable != true) Text(RatingText.threshold(view.feedbackMinimum), style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    Text("You can't edit ratings or feedback. Students' identities are never shown to you.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp))
                }

                SectionHeader("Professional details")
                CcTextField(title, { title = it }, label = "Title shown to students", maxLength = 80, hint = "For example: Senior Counsellor")
                CcTextField(bio, { bio = it }, label = "About you", singleLine = false, minLines = 4, maxLength = 1000, hint = "Your approach and what you can help with. No personal contact details.")
                Text("Areas of focus", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SPECIALIZATION_LABELS.forEach { (k, v) -> Pill(v, k in specs) { specs = if (k in specs) specs - k else specs + k } }
                }
                CcTextField(languages, { languages = it }, label = "Languages", hint = "Separate with commas, e.g. English, Telugu")
                Text("Session modes", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MODES.forEach { (k, v) -> Pill(v, k in modes) { modes = if (k in modes) modes - k else modes + k } }
                }
                if (modes.isEmpty()) Text("Choose at least one session mode.", style = MaterialTheme.typography.labelSmall, color = CcColors.Sos)

                SectionHeader("Qualifications")
                when {
                    p.pendingCredentials != null -> InfoBanner(
                        "Submitted ${p.pendingCredentials.submittedAt?.let { Fmt.ago(it) } ?: ""} and waiting for approval. Students keep seeing your last approved details until then.",
                        icon = Icons.Rounded.HourglassTop, tone = Tone.Amber,
                    )
                    p.credentialsApprovedAt != null -> Text("Approved ${Fmt.ago(p.credentialsApprovedAt)}. Changes need approval again.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                    else -> Text("Shown to students only after a Super Admin verifies them.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
                }
                CcTextField(quals, { quals = it }, label = "Qualifications (one per line)", singleLine = false, minLines = 3, maxLength = 1200, hint = "Up to 10, e.g. M.Phil. Clinical Psychology")
                CcTextField(
                    years, { years = it.filter(Char::isDigit).take(2) }, label = "Years of experience (optional)",
                    keyboardType = KeyboardType.Number, hint = if (yearsInvalid) "Enter 0–60" else null,
                )
            }
        }
    }
}

@Composable
private fun Pill(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(50)).background(if (on) CcColors.Forest else Color.White)
            .border(1.dp, if (on) CcColors.Forest else CcColors.Line, RoundedCornerShape(50))
            .clickable(role = Role.Checkbox, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
    ) { Text(label, color = if (on) Color.White else CcColors.Ink, style = MaterialTheme.typography.labelLarge) }
}
