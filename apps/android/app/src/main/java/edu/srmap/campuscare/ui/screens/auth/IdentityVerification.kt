package edu.srmap.campuscare.ui.screens.auth

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.rounded.Badge
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DocumentScanner
import androidx.compose.material.icons.rounded.Face
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.UploadFile
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.vector.ImageVector
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

@Composable
fun IdentityVerificationScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val user = app.session.user.value

    var evidenceType by rememberSaveable { mutableStateOf("id_card") }
    var identifier by rememberSaveable { mutableStateOf(user?.studentId ?: "") }
    var department by rememberSaveable { mutableStateOf(user?.department ?: "") }
    var campus by rememberSaveable { mutableStateOf("main") }

    var selectedImageBytes by remember { mutableStateOf<ByteArray?>(null) }
    var selectedBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var imageMime by remember { mutableStateOf("image/jpeg") }

    var consentGiven by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var uploadSuccess by remember { mutableStateOf(false) }

    // Gallery Picker launcher
    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        if (uri != null) {
            try {
                val inputStream = context.contentResolver.openInputStream(uri)
                val bytes = inputStream?.readBytes()
                inputStream?.close()
                if (bytes != null) {
                    selectedImageBytes = bytes
                    selectedBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    imageMime = context.contentResolver.getType(uri) ?: "image/jpeg"
                }
            } catch (e: Exception) {
                errorMessage = "Could not load selected image: ${e.message}"
            }
        }
    }

    // Camera capture bitmap launcher
    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicturePreview(),
    ) { bitmap: Bitmap? ->
        if (bitmap != null) {
            val bos = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, bos)
            selectedImageBytes = bos.toByteArray()
            selectedBitmap = bitmap
            imageMime = "image/jpeg"
        }
    }

    fun submit() {
        val bytes = selectedImageBytes
        if (bytes == null) {
            errorMessage = "Please take a photo or select an ID image first."
            return
        }
        if (!consentGiven) {
            errorMessage = "Please check the consent box before submitting."
            return
        }

        scope.launch {
            busy = true
            errorMessage = null
            try {
                app.api.auth.uploadVerificationEvidence(
                    bytes = bytes,
                    name = "verification-$evidenceType.jpg",
                    mime = imageMime,
                    evidenceType = evidenceType,
                    identifier = identifier.trim().uppercase(),
                    requestedRole = user?.role ?: "student",
                    department = department.takeIf { it.isNotBlank() },
                    campus = campus,
                )
                uploadSuccess = true
            } catch (e: ApiException) {
                errorMessage = e.message ?: "Upload failed. Please check network connection."
            } catch (e: Exception) {
                errorMessage = e.message ?: "An unexpected error occurred during upload."
            } finally {
                busy = false
            }
        }
    }

    CcScreen(
        title = "Identity Verification",
        subtitle = "Institutional verification evidence",
        onBack = { nav.popBackStack() },
    ) {
        if (uploadSuccess) {
            SuccessCard(onContinue = {
                nav.navigate(Routes.Home) { popUpTo(0) { inclusive = true } }
            })
            return@CcScreen
        }

        // Dedicated Isolation Notice
        InfoBanner(
            message = "Separation Guarantee: This verification capture is stored in an isolated institutional vault. It will NEVER be used as your public profile photo, avatar, or shown in chat channels.",
            tone = Tone.Brand,
            icon = Icons.Rounded.Security,
        )

        Spacer(Modifier.height(12.dp))

        // Type selection
        Text(
            text = "Evidence Type",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = CcColors.Ink,
        )
        Spacer(Modifier.height(6.dp))

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            EvidenceTypeCard(
                title = "ID Card",
                icon = Icons.Rounded.Badge,
                selected = evidenceType == "id_card",
                modifier = Modifier.weight(1f),
                onClick = { evidenceType = "id_card" },
            )
            EvidenceTypeCard(
                title = "Live Selfie",
                icon = Icons.Rounded.Face,
                selected = evidenceType == "selfie",
                modifier = Modifier.weight(1f),
                onClick = { evidenceType = "selfie" },
            )
            EvidenceTypeCard(
                title = "Document",
                icon = Icons.Rounded.DocumentScanner,
                selected = evidenceType == "document",
                modifier = Modifier.weight(1f),
                onClick = { evidenceType = "document" },
            )
        }

        Spacer(Modifier.height(16.dp))

        // Identification fields
        CcTextField(
            value = identifier,
            onValueChange = { identifier = it.uppercase() },
            label = "Student or Employee ID",
            placeholder = "e.g. AP21110010001",
            leadingIcon = Icons.Rounded.Badge,
        )

        Spacer(Modifier.height(8.dp))

        CcTextField(
            value = department,
            onValueChange = { department = it },
            label = "Department",
            placeholder = "e.g. Computer Science",
        )

        Spacer(Modifier.height(16.dp))

        // Camera or Photo Preview Area
        Text(
            text = "Capture Evidence",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = CcColors.Ink,
        )
        Spacer(Modifier.height(6.dp))

        val bitmap = selectedBitmap
        if (bitmap != null) {
            CcCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = "Evidence Preview",
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(200.dp)
                            .clip(RoundedCornerShape(12.dp)),
                        contentScale = ContentScale.Crop,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        CcButton(
                            text = "Retake",
                            onClick = {
                                selectedBitmap = null
                                selectedImageBytes = null
                            },
                            kind = ButtonKind.Outline,
                            leadingIcon = Icons.Rounded.Refresh,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        } else {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CcButton(
                    text = "Take Photo",
                    onClick = { cameraLauncher.launch(null) },
                    kind = ButtonKind.Brand,
                    leadingIcon = Icons.Rounded.CameraAlt,
                    modifier = Modifier.weight(1f),
                )
                CcButton(
                    text = "Upload File",
                    onClick = { photoPickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    kind = ButtonKind.Outline,
                    leadingIcon = Icons.Rounded.UploadFile,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        Spacer(Modifier.height(16.dp))

        // Consent Checkbox
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .clickable { consentGiven = !consentGiven }
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(
                checked = consentGiven,
                onCheckedChange = { consentGiven = it },
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = "I explicitly consent to institutional identity review of this document by authorized campus administrators.",
                style = MaterialTheme.typography.bodySmall,
                color = CcColors.Ink,
            )
        }

        errorMessage?.let { err ->
            Spacer(Modifier.height(8.dp))
            InfoBanner(message = err, tone = Tone.Danger, icon = Icons.Rounded.Info)
        }

        Spacer(Modifier.height(20.dp))

        CcButton(
            text = if (busy) "Uploading..." else "Submit for Verification",
            onClick = { submit() },
            kind = ButtonKind.Brand,
            enabled = !busy && selectedImageBytes != null && consentGiven,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun EvidenceTypeCard(
    title: String,
    icon: ImageVector,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val bg = if (selected) CcColors.Mint else Color.White
    val borderCol = if (selected) CcColors.Forest else CcColors.Forest.copy(alpha = 0.15f)
    val fg = if (selected) CcColors.Forest else CcColors.Ink

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.5.dp, borderCol, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(24.dp))
            Spacer(Modifier.height(4.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                color = fg,
            )
        }
    }
}

@Composable
private fun SuccessCard(onContinue: () -> Unit) {
    CcCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                Icons.Rounded.CheckCircle,
                contentDescription = null,
                tint = CcColors.Forest,
                modifier = Modifier.size(56.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Verification Submitted",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = CcColors.Ink,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Your verification evidence has been securely queued for administrator review. Your account will be operational as soon as review is completed.",
                style = MaterialTheme.typography.bodyMedium,
                color = CcColors.InkSoft,
            )
            Spacer(Modifier.height(20.dp))
            CcButton(
                text = "Continue",
                onClick = onContinue,
                kind = ButtonKind.Brand,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
