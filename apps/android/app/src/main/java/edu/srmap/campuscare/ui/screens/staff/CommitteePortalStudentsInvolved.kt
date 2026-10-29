package edu.srmap.campuscare.ui.screens.staff

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults.SecondaryIndicator
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.srmap.campuscare.data.CommitteeStudentReporter
import edu.srmap.campuscare.data.CommitteeStudentRespondent
import edu.srmap.campuscare.ui.components.Avatar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.SkeletonList
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.theme.CcColors

/**
 * Screen 5: Students Involved (Part B)
 *
 * Visual elements matching reference:
 * - Header: "Students Involved"
 * - Segmented Tabs: "Reporter (1)" / "Respondent (1)"
 * - Student detail card with Age, Student ID, Department, Campus, and contact buttons
 */
@Composable
fun CommitteeStudentsInvolvedScreen(reportId: String = "demo") {
    val app = LocalApp.current
    val snack = LocalSnack.current
    val context = LocalContext.current

    var selectedTab by remember { mutableStateOf("Reporter") }

    val studentsLoad = rememberLoad(reportId) {
        app.api.committeePortal.studentsInvolved(reportId)
    }

    CcScreen(
        title = "Students Involved",
        subtitle = "Parties and respondents",
        onRefresh = { studentsLoad.reload() },
    ) {
        LoadContent(
            studentsLoad,
            skeleton = { SkeletonList(count = 3) },
        ) { data ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Segmented Tabs
                val tabs = listOf("Reporter (1)", "Respondent (1)")
                TabRow(
                    selectedTabIndex = if (selectedTab == "Reporter") 0 else 1,
                    containerColor = Color.Transparent,
                    contentColor = CcColors.Forest,
                    indicator = { tabPositions ->
                        val idx = if (selectedTab == "Reporter") 0 else 1
                        SecondaryIndicator(
                            Modifier.tabIndicatorOffset(tabPositions[idx]),
                            color = CcColors.Forest,
                            height = 3.dp,
                        )
                    },
                    divider = {},
                ) {
                    tabs.forEach { tabTitle ->
                        val isSel = (tabTitle.startsWith("Reporter") && selectedTab == "Reporter") ||
                            (tabTitle.startsWith("Respondent") && selectedTab == "Respondent")
                        Tab(
                            selected = isSel,
                            onClick = { selectedTab = if (tabTitle.startsWith("Reporter")) "Reporter" else "Respondent" },
                            text = {
                                Text(
                                    text = tabTitle,
                                    fontWeight = if (isSel) FontWeight.Bold else FontWeight.Medium,
                                    color = if (isSel) CcColors.Forest else CcColors.InkSoft,
                                    fontSize = 13.sp,
                                )
                            },
                        )
                    }
                }

                if (selectedTab == "Reporter") {
                    ReporterProfileSection(
                        reporter = data.reporter,
                        onCall = {
                            if (data.reporter.phone.isNotBlank()) {
                                val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:${data.reporter.phone}"))
                                context.startActivity(intent)
                            } else {
                                snack.show("Phone number not available")
                            }
                        },
                        onEmail = {
                            if (data.reporter.email.isNotBlank()) {
                                val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:${data.reporter.email}"))
                                context.startActivity(intent)
                            }
                        },
                    )
                } else {
                    RespondentSection(respondent = data.respondent)
                }
            }
        }
    }
}

@Composable
private fun ReporterProfileSection(
    reporter: CommitteeStudentReporter,
    onCall: () -> Unit,
    onEmail: () -> Unit,
) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(name = reporter.name, size = 52.dp)
                    Column {
                        Text(
                            text = reporter.name,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = reporter.academicYear,
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                }

                StatusChip(text = "REPORTER", tone = Tone.Violet)
            }

            // Student Information Fields
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                StudentFieldRow(label = "Student ID", value = reporter.studentId)
                StudentFieldRow(label = "Department", value = reporter.department)
                StudentFieldRow(label = "Campus", value = reporter.campus.ifBlank { "Main Campus" })
                StudentFieldRow(label = "Age", value = "${reporter.age} years")
                StudentFieldRow(label = "Previous Reports", value = "${reporter.previousReportsCount} records")
            }

            // Contact Action Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                CcButton(
                    text = "Call Student",
                    onClick = onCall,
                    leadingIcon = Icons.Rounded.Call,
                    kind = ButtonKind.Primary,
                    modifier = Modifier.weight(1f),
                )
                CcButton(
                    text = "Email",
                    onClick = onEmail,
                    leadingIcon = Icons.Rounded.Email,
                    kind = ButtonKind.Outline,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun RespondentSection(respondent: CommitteeStudentRespondent) {
    CcCard(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Avatar(name = respondent.name, size = 48.dp)
                    Column {
                        Text(
                            text = respondent.name,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            color = CcColors.Ink,
                        )
                        Text(
                            text = respondent.department,
                            style = MaterialTheme.typography.bodySmall,
                            color = CcColors.InkSoft,
                        )
                    }
                }

                StatusChip(text = respondent.status.uppercase(), tone = Tone.Amber)
            }

            StudentFieldRow(label = "Role in Incident", value = respondent.role)
            StudentFieldRow(label = "Hearing Status", value = respondent.status)

            Text(
                text = "Respondent party notified for formal committee inquiry meeting.",
                style = MaterialTheme.typography.bodySmall,
                color = CcColors.InkSoft,
            )
        }
    }
}

@Composable
private fun StudentFieldRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
        Text(text = value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = CcColors.Ink)
    }
}

