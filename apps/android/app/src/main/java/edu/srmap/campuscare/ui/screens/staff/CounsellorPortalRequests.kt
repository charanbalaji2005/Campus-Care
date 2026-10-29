package edu.srmap.campuscare.ui.screens.staff

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PriorityHigh
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.StudentRequestItem
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import kotlinx.coroutines.launch

/**
 * Screen 3: Student Requests
 *
 * Dedicated requests queue matching Screen 3 of the reference design:
 * - Tabs: Pending, Approved, Completed
 * - Search by student name or concern
 * - Priority indicators and validated concern tags
 * - Actions to Accept, Decline, Propose alternate time, or View Profile
 */
@Composable
fun StudentRequestsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()

    var statusTab by rememberSaveable { mutableStateOf("pending") } // "pending", "approved", "completed"
    var searchQuery by rememberSaveable { mutableStateOf("") }

    val requests = rememberLoad(statusTab) { app.api.counselling.requests(status = statusTab) }

    LaunchedEffect(Unit) {
        app.realtime.events.collect { e ->
            if (e.name == "counselling:request" || e.name == "appointment:updated") {
                requests.reload()
            }
        }
    }

    var declineTargetId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun handleAccept(reqId: String) {
        scope.launch {
            busy = true
            try {
                app.api.counselling.update(reqId, status = "confirmed")
                snack.show("Request accepted and appointment confirmed.")
                requests.reload()
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    fun handleDecline(reqId: String, reason: String) {
        scope.launch {
            busy = true
            try {
                app.api.counselling.update(reqId, status = "rejected", reason = reason)
                snack.show("Request declined.")
                requests.reload()
            } catch (e: ApiException) {
                snack.error(e)
            } finally {
                busy = false
            }
        }
    }

    CcScreen(
        title = "Student Requests",
        subtitle = "Review and triage incoming student consultation requests",
        refreshing = requests.refreshing,
        onRefresh = { requests.reload() },
    ) {
        // Tab row
        ChoiceChips(
            options = listOf(
                "pending" to "Pending",
                "approved" to "Approved",
                "completed" to "Completed",
            ),
            selected = statusTab,
            onSelect = { statusTab = it },
        )

        // Search field
        CcTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            label = "Search requests by name or concern",
            leadingIcon = Icons.Rounded.Search,
        )

        LoadContent(requests, skeleton = { SkeletonList(3) }) { list ->
            val filtered = list.filter { r ->
                searchQuery.isBlank() ||
                    r.studentName.contains(searchQuery, ignoreCase = true) ||
                    r.studentDepartment.contains(searchQuery, ignoreCase = true) ||
                    (r.reason?.contains(searchQuery, ignoreCase = true) == true) ||
                    r.tags.any { it.contains(searchQuery, ignoreCase = true) }
            }

            if (filtered.isEmpty()) {
                EmptyState(
                    title = "No requests found",
                    message = if (statusTab == "pending") "No pending student requests awaiting review." else "No requests in this category.",
                    icon = Icons.Rounded.HourglassTop,
                    tone = Tone.Teal,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    filtered.forEachIndexed { i, req ->
                        Column(Modifier.enterStagger(i)) {
                            StudentRequestCard(
                                request = req,
                                onAccept = { handleAccept(req.id) },
                                onDecline = { declineTargetId = req.id },
                                onViewProfile = { nav.navigate(Routes.counsellorStudentProfile(req.studentId)) },
                                busy = busy,
                            )
                        }
                    }
                }
            }
        }
    }

    declineTargetId?.let { id ->
        InputDialog(
            title = "Decline Request",
            message = "Provide a supportive note and explanation for the student.",
            label = "Reason for student",
            confirmLabel = "Decline",
            destructive = true,
            loading = busy,
            onDismiss = { declineTargetId = null },
            onConfirm = { reason ->
                declineTargetId = null
                handleDecline(id, reason.trim())
            },
        )
    }
}

@Composable
private fun StudentRequestCard(
    request: StudentRequestItem,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onViewProfile: () -> Unit,
    busy: Boolean,
) {
    CcCard(padding = 14.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header with Student info and priority badge
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(request.studentName, tone = Tone.Violet, size = 46.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = request.studentName,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = CcColors.Ink,
                        )
                        if (request.priority == "high" || request.priority == "urgent") {
                            Spacer(Modifier.width(8.dp))
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(CcColors.AmberSoft)
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Rounded.PriorityHigh, contentDescription = null, tint = CcColors.Amber, modifier = Modifier.size(12.dp))
                                    Spacer(Modifier.width(2.dp))
                                    Text("High Priority", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = CcColors.Amber)
                                }
                            }
                        }
                    }
                    Text(
                        text = listOfNotNull(request.studentYear.ifBlank { null }, request.studentDepartment.ifBlank { null }).joinToString(" · ").ifBlank { "SRM Student" },
                        style = MaterialTheme.typography.bodySmall,
                        color = CcColors.InkSoft,
                    )
                }
                Text(
                    text = Fmt.ago(request.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = CcColors.InkFaint,
                )
            }

            // Reason provided by student
            request.reason?.takeIf { it.isNotBlank() }?.let { reasonText ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(CcColors.Cream)
                        .padding(10.dp),
                ) {
                    Text(
                        text = "\"$reasonText\"",
                        style = MaterialTheme.typography.bodyMedium,
                        color = CcColors.Ink,
                    )
                }
            }

            // Concern Tags & Mode
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Concern chips
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    request.tags.take(3).forEach { tag ->
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(CcColors.Mint50)
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                        ) {
                            Text(tag, style = MaterialTheme.typography.labelSmall, color = CcColors.Forest)
                        }
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (request.mode == "online") Icons.Rounded.Videocam else Icons.Rounded.School,
                        contentDescription = null,
                        tint = CcColors.InkSoft,
                        modifier = Modifier.size(14.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = if (request.mode == "online") "Online" else "In-Person",
                        style = MaterialTheme.typography.labelSmall,
                        color = CcColors.InkSoft,
                    )
                }
            }

            // Actions
            if (request.status == "requested" || request.status == "pending") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CcButton(
                        text = "Accept",
                        onClick = onAccept,
                        modifier = Modifier.weight(1.2f),
                        kind = ButtonKind.Brand,
                        leadingIcon = Icons.Rounded.Check,
                        loading = busy,
                    )
                    CcButton(
                        text = "Decline",
                        onClick = onDecline,
                        modifier = Modifier.weight(1f),
                        kind = ButtonKind.Outline,
                        leadingIcon = Icons.Rounded.Close,
                        enabled = !busy,
                    )
                    CcButton(
                        text = "Profile",
                        onClick = onViewProfile,
                        modifier = Modifier.weight(1f),
                        kind = ButtonKind.Soft,
                        leadingIcon = Icons.Rounded.Person,
                    )
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CcButton(
                        text = "View Student Profile",
                        onClick = onViewProfile,
                        modifier = Modifier.fillMaxWidth(),
                        kind = ButtonKind.Outline,
                        leadingIcon = Icons.Rounded.Person,
                    )
                }
            }
        }
    }
}
