package edu.srmap.campuscare.ui.screens.student

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.EmojiObjects
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Title
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import edu.srmap.campuscare.data.ApiException
import edu.srmap.campuscare.data.Attachment
import edu.srmap.campuscare.data.ContactCard
import edu.srmap.campuscare.data.LostFoundItem
import edu.srmap.campuscare.ui.components.BottomActionBar
import edu.srmap.campuscare.ui.components.ButtonKind
import edu.srmap.campuscare.ui.components.CcButton
import edu.srmap.campuscare.ui.components.CcCard
import edu.srmap.campuscare.ui.components.CcScreen
import edu.srmap.campuscare.ui.components.CcSelect
import edu.srmap.campuscare.ui.components.CcTextField
import edu.srmap.campuscare.ui.components.ChoiceChips
import edu.srmap.campuscare.ui.components.ConfirmDialog
import edu.srmap.campuscare.ui.components.EmptyState
import edu.srmap.campuscare.ui.components.IconBadge
import edu.srmap.campuscare.ui.components.InfoBanner
import edu.srmap.campuscare.ui.components.InputDialog
import edu.srmap.campuscare.ui.components.KeyValue
import edu.srmap.campuscare.ui.components.LoadContent
import edu.srmap.campuscare.ui.components.LocalApp
import edu.srmap.campuscare.ui.components.LocalNav
import edu.srmap.campuscare.ui.components.LocalSnack
import edu.srmap.campuscare.ui.components.SectionHeader
import edu.srmap.campuscare.ui.components.StatusChip
import edu.srmap.campuscare.ui.components.SwitchRow
import edu.srmap.campuscare.ui.components.Tone
import edu.srmap.campuscare.ui.components.enterStagger
import edu.srmap.campuscare.ui.components.rememberLoad
import edu.srmap.campuscare.ui.navigation.Routes
import edu.srmap.campuscare.ui.theme.CcColors
import edu.srmap.campuscare.util.Fmt
import edu.srmap.campuscare.util.dial
import edu.srmap.campuscare.util.openUrl
import edu.srmap.campuscare.util.readPicked
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.launch

private val LF_CATEGORIES = listOf(
    "id_card" to "ID card", "electronics" to "Electronics", "keys" to "Keys", "wallet" to "Wallet",
    "bag" to "Bag", "books" to "Books", "clothing" to "Clothing", "other" to "Other",
)

private fun lfLabel(key: String) = LF_CATEGORIES.firstOrNull { it.first == key }?.second ?: Fmt.humanize(key)

@Composable
fun LostFoundScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    var type by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var applied by rememberSaveable { mutableStateOf("") }
    val page = rememberLoad(type to applied) {
        app.api.community.lostFound(type = type.takeIf { it == "lost" || it == "found" }, q = applied, mine = type == "mine")
    }
    CcScreen(
        title = "Lost & Found",
        subtitle = "Help belongings find their way home",
        onBack = { nav.popBackStack() },
        refreshing = page.refreshing, onRefresh = { page.reload() },
        floating = { CcButton("Post", { nav.navigate(Routes.LostFoundNew) }, kind = ButtonKind.Brand, leadingIcon = Icons.Rounded.Add) },
    ) {
        CcTextField(query, { query = it; if (it.isBlank()) applied = "" }, label = "Search items", leadingIcon = Icons.Rounded.Search, onImeAction = { applied = query.trim() })
        ChoiceChips(listOf("all" to "All", "lost" to "Lost", "found" to "Found", "mine" to "My posts"), type, { type = it })
        LoadContent(page) { p ->
            when {
                p.disabled -> EmptyState("Lost & found is turned off", icon = Icons.Rounded.Inventory2)
                p.items.isEmpty() -> EmptyState("Nothing here yet", message = "Lost something or found something? Post it so others can help.", icon = Icons.Rounded.Inventory2)
                else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { p.items.forEachIndexed { i, item -> LostFoundRow(item, Modifier.enterStagger(i)) } }
            }
        }
    }
}

@Composable
private fun LostFoundRow(item: LostFoundItem, modifier: Modifier = Modifier) {
    val app = LocalApp.current
    val nav = LocalNav.current
    CcCard(modifier, onClick = { nav.navigate(Routes.lostFoundItem(item.id)) }, padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val photo = item.photoIds.firstOrNull()
            if (photo != null) {
                AsyncImage(
                    model = app.api.community.lostFoundPhotoUrl(photo), imageLoader = app.imageLoader, contentDescription = item.title, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(64.dp).clip(RoundedCornerShape(14.dp)),
                )
            } else {
                IconBadge(Icons.Rounded.Inventory2, if (item.type == "lost") Tone.Rose else Tone.Teal, size = 64.dp, iconSize = 28.dp)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusChip(if (item.type == "lost") "Lost" else "Found", if (item.type == "lost") Tone.Rose else Tone.Teal)
                    if (item.status != "open") StatusChip(Fmt.humanize(item.status), Tone.Neutral)
                }
                Text(item.title, style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.padding(top = 4.dp), maxLines = 1)
                Text("${lfLabel(item.category)} · ${item.location} · ${Fmt.ago(item.createdAt)}", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft, maxLines = 1)
            }
        }
    }
}

@Composable
fun LostFoundNewScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var type by rememberSaveable { mutableStateOf("lost") }
    var title by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var location by rememberSaveable { mutableStateOf("") }
    var daysAgo by rememberSaveable { mutableStateOf("0") }
    val photos = remember { mutableStateListOf<Attachment>() }
    var uploading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    val maxBytes = app.config.settings.maxImageMb * 1024L * 1024L
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(3)) { uris ->
        scope.launch {
            uploading = true
            for (u in uris.take(3 - photos.size)) {
                try {
                    val f = readPicked(context, u, maxBytes)
                    photos.add(app.api.community.uploadLostFoundPhoto(f.bytes, f.name, f.mime))
                } catch (e: ApiException) {
                    snack.show(e.message ?: "Upload failed.")
                }
            }
            uploading = false
        }
    }

    CcScreen(
        title = "Post an item", subtitle = "Lost or found on campus", onBack = { nav.popBackStack() },
        bottomBar = {
            BottomActionBar {
                CcButton("Post", {
                    errors = buildMap {
                        if (title.trim().length < 3) put("title", "Add a short title")
                        if (description.trim().length < 5) put("description", "Add a few details")
                        if (category == null) put("category", "Choose a category")
                        if (location.trim().length < 2) put("location", "Where?")
                    }
                    if (errors.isNotEmpty()) return@CcButton
                    scope.launch {
                        busy = true
                        try {
                            val at = Instant.now().minus((daysAgo.toLongOrNull() ?: 0L), ChronoUnit.DAYS).toString()
                            val item = app.api.community.createLostFound(
                                mapOf(
                                    "type" to type, "title" to title.trim(), "description" to description.trim(), "category" to category,
                                    "location" to location.trim(), "occurredAt" to at, "photoIds" to photos.map { it.id },
                                ),
                            )
                            nav.navigate(Routes.lostFoundItem(item.id)) { popUpTo(Routes.LostFound) }
                        } catch (e: ApiException) {
                            if (e.fields.isNotEmpty()) errors = e.fields
                            snack.error(e)
                        } finally {
                            busy = false
                        }
                    }
                }, Modifier.weight(1f), loading = busy, enabled = !uploading)
            }
        },
    ) {
        ChoiceChips(listOf("lost" to "I lost something", "found" to "I found something"), type, { type = it })
        CcTextField(title, { title = it }, label = "What is it?", placeholder = "e.g. Blue water bottle", leadingIcon = Icons.Rounded.Title, error = errors["title"], maxLength = 120)
        CcSelect("Category", LF_CATEGORIES, category, { category = it }, error = errors["category"])
        CcTextField(description, { description = it }, label = "Description", placeholder = "Colour, brand, distinguishing marks", singleLine = false, minLines = 3, maxLength = 1000, error = errors["description"])
        CcTextField(location, { location = it }, label = if (type == "lost") "Where did you lose it?" else "Where did you find it?", leadingIcon = Icons.Rounded.Place, error = errors["location"], maxLength = 200)
        Text("When?", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        ChoiceChips(listOf("0" to "Today", "1" to "Yesterday", "3" to "This week", "10" to "Earlier"), daysAgo, { daysAgo = it })
        if (type == "found" && category == "id_card") {
            InfoBanner("For ID cards, don't post a photo showing the person's details. Hand it to the security office.", tone = Tone.Amber, icon = Icons.Rounded.Lock)
        }
        Text("Photos (optional, up to 3)", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            photos.forEach { ph ->
                Box {
                    AsyncImage(
                        model = app.api.community.lostFoundPhotoUrl(ph.id), imageLoader = app.imageLoader, contentDescription = ph.name, contentScale = ContentScale.Crop,
                        modifier = Modifier.size(90.dp).clip(RoundedCornerShape(14.dp)),
                    )
                    IconButton(onClick = { photos.remove(ph) }, modifier = Modifier.align(Alignment.TopEnd).size(28.dp).background(CcColors.Ink.copy(alpha = 0.5f), RoundedCornerShape(50))) {
                        Icon(Icons.Rounded.Close, contentDescription = "Remove photo", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(16.dp))
                    }
                }
            }
            if (photos.size < 3) {
                CcButton(if (uploading) "Uploading…" else "Add photo", { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.AddPhotoAlternate, enabled = !uploading)
            }
        }
        Text("Contact details are only shared after you approve a claim.", style = MaterialTheme.typography.labelSmall, color = CcColors.InkSoft)
    }
}

@Composable
fun LostFoundItemScreen(id: String) {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val item = rememberLoad(id) { app.api.community.lostFoundItem(id) }
    var claiming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var confirmStatus by remember { mutableStateOf<String?>(null) }

    CcScreen(title = item.data?.title ?: "Item", subtitle = item.data?.let { if (it.type == "lost") "Lost item" else "Found item" }, onBack = { nav.popBackStack() }, refreshing = item.refreshing, onRefresh = { item.reload() }) {
        LoadContent(item) { i ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (i.photoIds.isNotEmpty()) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        i.photoIds.forEach { pid ->
                            AsyncImage(
                                model = app.api.community.lostFoundPhotoUrl(pid), imageLoader = app.imageLoader, contentDescription = i.title, contentScale = ContentScale.Crop,
                                modifier = Modifier.size(240.dp, 180.dp).clip(RoundedCornerShape(18.dp)),
                            )
                        }
                    }
                }
                CcCard {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StatusChip(if (i.type == "lost") "Lost" else "Found", if (i.type == "lost") Tone.Rose else Tone.Teal)
                        StatusChip(Fmt.humanize(i.status), if (i.status == "open") Tone.Brand else Tone.Neutral, dot = true)
                    }
                    KeyValue("Description", i.description)
                    KeyValue("Category", lfLabel(i.category))
                    KeyValue("Location", i.location)
                    KeyValue("When", Fmt.date(i.occurredAt))
                    KeyValue("Posted", Fmt.ago(i.createdAt))
                }
                if (i.mine) {
                    SectionHeader("Claims (${i.claims.size})")
                    if (i.claims.isEmpty()) Text("No claims yet. You'll be notified when someone responds.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                    i.claims.forEach { c ->
                        CcCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(c.claimant?.name ?: "A student", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink, modifier = Modifier.weight(1f))
                                StatusChip(Fmt.humanize(c.status), when (c.status) { "approved" -> Tone.Brand; "rejected" -> Tone.Neutral; else -> Tone.Amber })
                            }
                            c.message?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp)) }
                            if (c.status == "approved") c.claimant?.let { ContactRow(it) }
                            if (c.status == "pending") {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                                    listOf("approve" to "Approve", "reject" to "Reject").forEach { (d, label) ->
                                        CcButton(label, {
                                            scope.launch {
                                                try {
                                                    app.api.community.decideClaim(c.id, d); item.reload()
                                                    snack.show(if (d == "approve") "Approved — contact details are now shared with each other." else "Claim rejected.")
                                                } catch (e: ApiException) {
                                                    snack.error(e)
                                                }
                                            }
                                        }, Modifier.weight(1f), kind = if (d == "approve") ButtonKind.Brand else ButtonKind.Outline)
                                    }
                                }
                            }
                        }
                    }
                    if (i.status == "open" || i.status == "claimed") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CcButton("Mark returned", { confirmStatus = "returned" }, Modifier.weight(1f), kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.CheckCircle)
                            CcButton("Close post", { confirmStatus = "closed" }, Modifier.weight(1f), kind = ButtonKind.Ghost)
                        }
                    }
                } else {
                    val myClaim = i.claims.firstOrNull()
                    when {
                        myClaim == null && i.status == "open" -> CcButton(if (i.type == "found") "This is mine" else "I found this", { claiming = true }, Modifier.fillMaxWidth(), kind = ButtonKind.Brand)
                        myClaim != null -> CcCard {
                            Text("Your claim: ${Fmt.humanize(myClaim.status)}", style = MaterialTheme.typography.titleSmall, color = CcColors.Ink)
                            if (myClaim.status == "approved") myClaim.poster?.let { ContactRow(it) } else Text("The poster will review it. Contact details are shared only after approval.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                        }
                    }
                }
            }
            if (claiming) {
                InputDialog(
                    if (i.type == "found") "Claim this item" else "Tell the owner",
                    if (i.type == "found") "Describe something only the owner would know (e.g. what's inside, a scratch, the lock screen)." else "Say where you found it and how to get it back.",
                    label = "Message", confirmLabel = "Send", minLength = 10, loading = busy,
                    onDismiss = { claiming = false },
                    onConfirm = { msg ->
                        scope.launch {
                            busy = true
                            try {
                                app.api.community.claim(i.id, msg.trim()); claiming = false; item.reload(); snack.show("Sent. You'll be notified when they respond.")
                            } catch (e: ApiException) {
                                snack.error(e)
                            } finally {
                                busy = false
                            }
                        }
                    },
                )
            }
            confirmStatus?.let { st ->
                ConfirmDialog(
                    if (st == "returned") "Mark as returned?" else "Close this post?", "It will no longer appear in the open list.",
                    confirmLabel = "Confirm",
                    onDismiss = { confirmStatus = null },
                    onConfirm = {
                        scope.launch {
                            try {
                                app.api.community.setLostFoundStatus(i.id, st); confirmStatus = null; item.reload()
                            } catch (e: ApiException) {
                                snack.error(e)
                            }
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun ContactRow(c: ContactCard) {
    val context = LocalContext.current
    Column(Modifier.padding(top = 8.dp)) {
        Text("Contact ${c.name}", style = MaterialTheme.typography.labelLarge, color = CcColors.Forest)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            c.phone?.takeIf { it.isNotBlank() }?.let { p -> CcButton("Call", { context.dial(p) }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Call) }
            c.email?.takeIf { it.isNotBlank() }?.let { m -> CcButton("Email", { context.openUrl("mailto:$m") }, kind = ButtonKind.Soft, leadingIcon = Icons.Rounded.Email) }
        }
    }
}

// ------------------------------------------------------------------ anonymous suggestions

private val SUGGESTION_CATEGORIES = listOf(
    "lighting" to "Lighting", "security" to "Security", "infrastructure" to "Infrastructure", "transport" to "Transport",
    "hostel" to "Hostel", "wellbeing" to "Wellbeing", "other" to "Other",
)

@Composable
fun SuggestionsScreen() {
    val app = LocalApp.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val data = rememberLoad { app.api.community.suggestions() }
    var category by rememberSaveable { mutableStateOf("lighting") }
    var text by rememberSaveable { mutableStateOf("") }
    var anonymous by rememberSaveable { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    CcScreen(title = "Suggestions", subtitle = "Ideas to make campus safer", onBack = { nav.popBackStack() }, refreshing = data.refreshing, onRefresh = { data.reload() }) {
        CcCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconBadge(Icons.Rounded.EmojiObjects, Tone.Amber)
                Spacer(Modifier.width(10.dp))
                Text("Share an idea", style = MaterialTheme.typography.titleMedium, color = CcColors.Ink)
            }
            Spacer(Modifier.height(10.dp))
            ChoiceChips(SUGGESTION_CATEGORIES, category, { category = it })
            CcTextField(text, { text = it }, label = "Your suggestion", singleLine = false, minLines = 3, maxLength = 2000, modifier = Modifier.padding(top = 10.dp))
            SwitchRow("Submit anonymously", anonymous, { anonymous = it }, description = "Staff see the idea, not who sent it.")
            CcButton("Send suggestion", {
                if (text.trim().length < 10) {
                    snack.show("Please write at least 10 characters.")
                    return@CcButton
                }
                scope.launch {
                    busy = true
                    try {
                        app.api.community.suggest(category, text.trim(), anonymous); text = ""; data.reload(); snack.show("Thank you! Your suggestion was sent.")
                    } catch (e: ApiException) {
                        snack.error(e)
                    } finally {
                        busy = false
                    }
                }
            }, Modifier.fillMaxWidth().padding(top = 6.dp), loading = busy)
        }
        LoadContent(data) { d ->
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (d.youSaidWeDid.isNotEmpty()) {
                    SectionHeader("You said, we did")
                    d.youSaidWeDid.forEach { s ->
                        CcCard(color = CcColors.Mint50) {
                            StatusChip(SUGGESTION_CATEGORIES.firstOrNull { it.first == s.category }?.second ?: s.category, Tone.Brand)
                            Text(s.text, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp))
                            s.response?.let { Text("✓ $it", style = MaterialTheme.typography.bodyMedium, color = CcColors.Forest, modifier = Modifier.padding(top = 6.dp)) }
                        }
                    }
                }
                SectionHeader("My suggestions")
                if (d.mine.isEmpty()) Text("You haven't sent any suggestions yet.", style = MaterialTheme.typography.bodySmall, color = CcColors.InkSoft)
                d.mine.forEach { s ->
                    CcCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(SUGGESTION_CATEGORIES.firstOrNull { it.first == s.category }?.second ?: s.category, style = MaterialTheme.typography.labelLarge, color = CcColors.InkSoft, modifier = Modifier.weight(1f))
                            StatusChip(Fmt.humanize(s.status), when (s.status) { "done" -> Tone.Brand; "planned" -> Tone.Sky; "declined" -> Tone.Neutral; else -> Tone.Amber })
                        }
                        Text(s.text, style = MaterialTheme.typography.bodyMedium, color = CcColors.Ink, modifier = Modifier.padding(top = 6.dp))
                        s.response?.let { Text("Response: $it", style = MaterialTheme.typography.bodySmall, color = CcColors.Forest, modifier = Modifier.padding(top = 6.dp)) }
                        Text(Fmt.date(s.createdAt), style = MaterialTheme.typography.labelSmall, color = CcColors.InkFaint, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}
