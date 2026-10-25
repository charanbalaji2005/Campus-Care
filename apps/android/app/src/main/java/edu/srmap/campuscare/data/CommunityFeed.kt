package edu.srmap.campuscare.data

import kotlinx.serialization.Serializable
import java.net.URLEncoder
import java.util.UUID

// ------------------------------------------------------------------ community feed (public, moderated)

/** Feed categories, in display order. "announcements" is reserved for official accounts (enforced by the server). */
val FEED_CATEGORIES = listOf(
    "campus_safety" to "Campus Safety",
    "announcements" to "Announcements",
    "events" to "Events",
    "awareness" to "Awareness",
    "academic" to "Academic",
    "wellbeing" to "Well-being",
    "lost_found" to "Lost & Found",
)

fun feedCategoryLabel(key: String?): String = FEED_CATEGORIES.firstOrNull { it.first == key }?.second ?: key.orEmpty()

val FEED_REPORT_REASONS = listOf(
    "spam" to "Spam or advertising",
    "harassment" to "Harassment or bullying",
    "threat" to "Threat or violence",
    "discrimination" to "Hate or discrimination",
    "personal_info" to "Shares someone's personal information",
    "misinformation" to "False or misleading safety information",
    "self_harm" to "Someone may be at risk of self-harm",
    "other" to "Something else",
)

/** Same numbers as FEED_LIMITS on the server, which enforces them. */
object FeedLimits {
    const val POST_MAX_CHARS = 2000
    const val COMMENT_MAX_CHARS = 1000
    const val MAX_TAGS = 5
    const val MAX_ATTACHMENTS = 4
    const val ATTACHMENT_MAX_MB = 5
    const val MAX_RESOURCE_LINKS = 5
    const val MAX_PINNED = 3
}

fun newClientId(): String = UUID.randomUUID().toString()

@Serializable
data class FeedAuthor(val name: String = "", val roleLabel: String = "", val badge: String? = null, val verified: Boolean = false)

@Serializable
data class FeedChannelRef(val slug: String, val name: String)

@Serializable
data class ResourceLink(val title: String, val url: String)

/** A post in the main feed or an official channel. Permission flags are decided by the server. */
@Serializable
data class FeedPost(
    val id: String,
    val body: String = "",
    val category: String = "",
    val topic: String? = null,
    val topicLabel: String? = null,
    val tags: List<String> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
    val resourceLinks: List<ResourceLink> = emptyList(),
    val locationLabel: String? = null,
    val official: Boolean = false,
    val channel: FeedChannelRef? = null,
    val author: FeedAuthor = FeedAuthor(),
    val status: String = "published",
    val pinned: Boolean = false,
    val commentsEnabled: Boolean = true,
    val reactionCount: Int = 0,
    val commentCount: Int = 0,
    val myReaction: String? = null,
    val bookmarked: Boolean = false,
    val viewCount: Int? = null,
    val bookmarkCount: Int? = null,
    val mine: Boolean = false,
    val canEdit: Boolean = false,
    val canDelete: Boolean = false,
    val canPin: Boolean = false,
    val canModerate: Boolean = false,
    val canAppeal: Boolean = false,
    val moderationNote: String? = null,
    val scheduledAt: String? = null,
    val publishedAt: String? = null,
    val editedAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class FeedPage(val items: List<FeedPost> = emptyList(), val pinned: List<FeedPost> = emptyList(), val nextCursor: String? = null, val disabled: Boolean = false)

@Serializable
data class PostResult(val post: FeedPost, val duplicate: Boolean = false, val held: Boolean = false, val message: String? = null, val crisisSupport: String? = null)

@Serializable
data class FeedComment(
    val id: String,
    val parentId: String? = null,
    val body: String = "",
    val author: FeedAuthor = FeedAuthor(),
    val isPostAuthor: Boolean = false,
    val status: String = "published",
    val mine: Boolean = false,
    val canEdit: Boolean = false,
    val canDelete: Boolean = false,
    val canModerate: Boolean = false,
    val moderationNote: String? = null,
    val editedAt: String? = null,
    val createdAt: String? = null,
    val replies: List<FeedComment> = emptyList(),
)

@Serializable
data class CommentPage(val items: List<FeedComment> = emptyList(), val nextCursor: String? = null, val commentCount: Int = 0, val commentsEnabled: Boolean = true)

@Serializable
data class CommentResult(val comment: FeedComment, val duplicate: Boolean = false, val commentCount: Int = 0, val held: Boolean = false, val message: String? = null, val crisisSupport: String? = null)

@Serializable
data class ReactionResult(val reactionCount: Int = 0, val myReaction: String? = null)

@Serializable
data class BookmarkResult(val bookmarked: Boolean = false)

@Serializable
data class DeleteResult(val ok: Boolean = true, val commentCount: Int? = null)

@Serializable
data class MessageResult(val ok: Boolean = true, val message: String? = null, val duplicate: Boolean = false, val held: Boolean = false, val crisisSupport: String? = null)

/** Profile preview: only what the author already shows publicly. */
@Serializable
data class AuthorPreview(
    val name: String,
    val roleLabel: String = "",
    val verified: Boolean = false,
    val official: Boolean = false,
    val department: String? = null,
    val memberSince: Int? = null,
    val posts: Int? = null,
    val isSelf: Boolean = false,
    val blocked: Boolean = false,
    /** Set when the viewer is a student and the author is an active counsellor. */
    val counsellorId: String? = null,
)

@Serializable
data class BlockedUser(val id: String, val name: String, val createdAt: String? = null)

@Serializable
data class FeaturedEvent(val id: String, val title: String, val kind: String = "", val startsAt: String? = null, val endsAt: String? = null, val venue: String = "", val organizer: String = "")

@Serializable
data class FeaturedChannel(val slug: String, val name: String, val description: String = "", val latestPostAt: String? = null)

@Serializable
data class FeedFeatured(val announcements: List<FeedPost> = emptyList(), val events: List<FeaturedEvent> = emptyList(), val channel: FeaturedChannel? = null)

// ------------------------------------------------------------------ events

@Serializable
data class CommunityEvent(
    val id: String,
    val title: String,
    val description: String = "",
    val kind: String = "",
    val kindLabel: String = "",
    val startsAt: String? = null,
    val endsAt: String? = null,
    val venue: String = "",
    val organizer: String = "",
    val capacity: Int? = null,
    val status: String = "published",
    val channel: String? = null,
    val going: Int = 0,
    val interested: Int = 0,
    val myRsvp: String? = null,
    val past: Boolean = false,
    val canManage: Boolean = false,
)

@Serializable
data class EventPage(val items: List<CommunityEvent> = emptyList(), val canCreate: Boolean = false, val disabled: Boolean = false)

val EVENT_KINDS = listOf(
    "workshop" to "Safety workshop",
    "awareness" to "Awareness campaign",
    "campus_event" to "Campus event",
    "counselling_session" to "Counselling session",
)

// ------------------------------------------------------------------ moderation (community:moderate)

@Serializable
data class ReasonCount(val reason: String, val count: Int)

@Serializable
data class QueueItem(
    val id: String,
    val kind: String,
    val postId: String? = null,
    val body: String = "",
    val category: String? = null,
    val official: Boolean = false,
    val channel: String? = null,
    val authorLabel: String = "",
    val authorRole: String = "",
    val status: String = "",
    val holdFlags: List<String> = emptyList(),
    val openReports: Int = 0,
    val attachments: Int = 0,
    val createdAt: String? = null,
    val reasons: List<ReasonCount> = emptyList(),
    val details: List<String> = emptyList(),
)

@Serializable
data class QueueUser(val name: String, val role: String = "")

@Serializable
data class UserReportItem(val id: String, val reason: String, val details: String? = null, val createdAt: String? = null, val postId: String? = null, val user: QueueUser? = null)

@Serializable
data class ModerationQueue(val posts: List<QueueItem> = emptyList(), val comments: List<QueueItem> = emptyList(), val users: List<UserReportItem> = emptyList())

@Serializable
data class AppealContent(val body: String = "", val authorLabel: String = "", val status: String = "", val decision: String? = null, val decisionReason: String? = null)

@Serializable
data class AppealItem(
    val id: String,
    val targetType: String,
    val targetId: String,
    val reason: String = "",
    val status: String = "pending",
    val note: String? = null,
    val createdAt: String? = null,
    val canDecide: Boolean = false,
    val content: AppealContent? = null,
)

// ------------------------------------------------------------------ API

/** Community feed, comments, reports, blocks, events and feed moderation (all under /community). */
class CommunityFeedApi(private val c: ApiClient) {
    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

    suspend fun posts(category: String?, q: String?, cursor: String?, scope: String = "feed"): FeedPage {
        val params = listOfNotNull(
            "scope=$scope",
            category?.takeIf { it != "all" }?.let { "category=${enc(it)}" },
            q?.takeIf { it.isNotBlank() }?.let { "q=${enc(it)}" },
            cursor?.let { if (scope == "feed") "cursor=${enc(it)}" else "page=${enc(it)}" },
            "limit=15",
        )
        return c.get("/community/posts?" + params.joinToString("&"))
    }
    suspend fun featured(): FeedFeatured = c.get("/community/featured")
    suspend fun post(id: String): FeedPost = c.get("/community/posts/$id")
    suspend fun create(body: Map<String, Any?>): PostResult = c.post("/community/posts", body)
    suspend fun update(id: String, body: Map<String, Any?>): FeedPost = c.patch("/community/posts/$id", body)
    suspend fun delete(id: String): DeleteResult = c.delete("/community/posts/$id")
    suspend fun uploadImage(bytes: ByteArray, name: String, mime: String): Attachment = c.upload("/community/uploads", bytes, name, mime)
    fun fileUrl(id: String) = c.url("/community/files/$id")

    suspend fun react(id: String, kind: String = "like"): ReactionResult = c.put("/community/posts/$id/reaction", mapOf("kind" to kind))
    suspend fun unreact(id: String): ReactionResult = c.delete("/community/posts/$id/reaction")
    suspend fun bookmark(id: String, on: Boolean): BookmarkResult =
        if (on) c.put("/community/posts/$id/bookmark", emptyMap<String, Any?>()) else c.delete("/community/posts/$id/bookmark")

    suspend fun comments(postId: String, cursor: String?): CommentPage = c.get("/community/posts/$postId/comments" + (cursor?.let { "?cursor=${enc(it)}" } ?: ""))
    suspend fun comment(postId: String, body: String, parentId: String?, clientId: String): CommentResult =
        c.post("/community/posts/$postId/comments", mapOf("body" to body, "parentId" to parentId, "clientId" to clientId))
    suspend fun editComment(id: String, body: String): FeedComment = c.patch("/community/comments/$id", mapOf("body" to body))
    suspend fun deleteComment(id: String): DeleteResult = c.delete("/community/comments/$id")

    /** [via] is "post" or "comment": whose author to preview/block. */
    suspend fun author(via: String, id: String): AuthorPreview = c.get("/community/${via}s/$id/author")
    suspend fun block(via: String, id: String): MessageResult = c.post("/community/${via}s/$id/block-author")
    suspend fun blocks(): List<BlockedUser> = c.get("/community/blocks")
    suspend fun unblock(id: String): Ignored = c.delete("/community/blocks/$id")
    suspend fun report(targetType: String, targetId: String, reason: String, details: String?, via: String? = null): MessageResult =
        c.post("/community/reports", mapOf("targetType" to targetType, "targetId" to targetId, "reason" to reason, "details" to details, "via" to via).filterValues { it != null })
    suspend fun appeal(kind: String, id: String, reason: String): MessageResult = c.post("/community/${kind}s/$id/appeal", mapOf("reason" to reason))

    suspend fun events(past: Boolean, channel: String? = null): EventPage =
        c.get("/community/events?when=${if (past) "past" else "upcoming"}" + (channel?.let { "&channel=$it" } ?: ""))
    suspend fun event(id: String): CommunityEvent = c.get("/community/events/$id")
    suspend fun createEvent(body: Map<String, Any?>): CommunityEvent = c.post("/community/events", body)
    suspend fun cancelEvent(id: String): Ignored = c.post("/community/events/$id/cancel")
    suspend fun rsvp(id: String, status: String): CommunityEvent = c.post("/community/events/$id/rsvp", mapOf("status" to status))

    suspend fun moderationQueue(): ModerationQueue = c.get("/community/moderation/queue")
    suspend fun moderate(kind: String, id: String, action: String, reason: String?): Ignored =
        c.post("/community/moderation/${kind}s/$id", mapOf("action" to action, "reason" to reason))
    suspend fun decideUserReport(id: String, action: String): Ignored = c.post("/community/moderation/user-reports/$id", mapOf("action" to action))
    suspend fun appeals(status: String = "pending"): List<AppealItem> = c.get("/community/moderation/appeals?status=$status")
    suspend fun decideAppeal(id: String, decision: String, note: String?): Ignored = c.post("/community/moderation/appeals/$id", mapOf("decision" to decision, "note" to note))
}

/** Accessor kept outside [Api] so the community feed stays a self-contained feature. */
val Api.feed: CommunityFeedApi get() = CommunityFeedApi(client)
