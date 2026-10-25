package edu.srmap.campuscare.data

import kotlinx.serialization.Serializable
import java.net.URLEncoder

// ------------------------------------------------------------------ Official Counselling Support channel

@Serializable
data class ChannelTopic(val key: String, val label: String)

/** A verified counsellor listed in the channel, with their working-hours indicator. */
@Serializable
data class ChannelCounsellor(
    val counsellorId: String,
    val name: String,
    val title: String = "Counsellor",
    /** available | outside_hours | away */
    val availability: String = "away",
    val nextAvailableAt: String? = null,
)

@Serializable
data class OfficialChannelInfo(
    val id: String,
    val slug: String = "counselling",
    val name: String = "Official Counselling Support",
    val description: String = "",
    val verified: Boolean = true,
    val commentsEnabled: Boolean = true,
    val following: Boolean = false,
    val followers: Int = 0,
    /** Server-decided: only verified counsellors with publishing permission get true. */
    val canPublish: Boolean = false,
    val topics: List<ChannelTopic> = emptyList(),
    val counsellors: List<ChannelCounsellor> = emptyList(),
    val emergencyNotice: String = "",
)

@Serializable
data class OfficialPostPage(val items: List<FeedPost> = emptyList(), val pinned: List<FeedPost> = emptyList(), val nextCursor: String? = null)

@Serializable
data class ChannelTotals(
    val published: Int = 0,
    val drafts: Int = 0,
    val scheduled: Int = 0,
    val reactions: Int = 0,
    val comments: Int = 0,
    val views: Int = 0,
    val bookmarks: Int = 0,
    val commentsLast7Days: Int = 0,
    val reactionsLast7Days: Int = 0,
)

@Serializable
data class ChannelDashboard(val posts: List<FeedPost> = emptyList(), val totals: ChannelTotals = ChannelTotals(), val followers: Int = 0)

// ------------------------------------------------------------------ private counsellor conversations

@Serializable
data class ConversationCounsellor(val id: String, val name: String, val title: String = "Counsellor", val active: Boolean = true)

@Serializable
data class ConversationStudent(val id: String, val name: String, val studentId: String? = null)

@Serializable
data class ConversationAvailability(val status: String = "away", val nextAvailableAt: String? = null, val message: String = "")

@Serializable
data class CounsellingConversation(
    val id: String,
    /** direct | appointment */
    val kind: String = "direct",
    val counsellor: ConversationCounsellor? = null,
    val student: ConversationStudent? = null,
    val availability: ConversationAvailability = ConversationAvailability(),
    val closed: Boolean = false,
    val lastMessageAt: String? = null,
    val unread: Int = 0,
    val otherLastReadAt: String? = null,
    val emergencyNotice: String = "",
    val createdAt: String? = null,
)

/** Counsellor shown on a counselling thread's chat detail (working-hours indicator). */
@Serializable
data class ThreadCounsellor(val id: String, val name: String, val availability: String = "away", val availabilityMessage: String = "", val nextAvailableAt: String? = null)

/** Official Counselling Support channel and private counsellor conversations. */
class CounsellingChannelApi(private val c: ApiClient) {
    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8")

    suspend fun channel(): OfficialChannelInfo = c.get("/community/channels/counselling")
    suspend fun follow(following: Boolean): Ignored = c.post("/community/channels/counselling/follow", mapOf("following" to following))
    suspend fun posts(topic: String?, q: String?, cursor: String?): OfficialPostPage {
        val params = listOfNotNull(topic?.let { "topic=${enc(it)}" }, q?.takeIf { it.isNotBlank() }?.let { "q=${enc(it)}" }, cursor?.let { "cursor=${enc(it)}" }, "limit=15")
        return c.get("/community/channels/counselling/posts?" + params.joinToString("&"))
    }
    suspend fun create(body: Map<String, Any?>): PostResult = c.post("/community/channels/counselling/posts", body)
    suspend fun update(postId: String, body: Map<String, Any?>): FeedPost = c.patch("/community/channels/counselling/posts/$postId", body)
    suspend fun delete(postId: String): Ignored = c.delete("/community/channels/counselling/posts/$postId")
    suspend fun dashboard(): ChannelDashboard = c.get("/community/channels/counselling/dashboard")

    // Private conversations (never part of the public feed).
    suspend fun conversations(): List<CounsellingConversation> = c.get("/counselling/conversations")
    suspend fun startConversation(counsellorId: String): CounsellingConversation = c.post("/counselling/conversations", mapOf("counsellorId" to counsellorId))
}

/** Accessor kept outside [Api] so the counselling channel stays a self-contained feature. */
val Api.counsellingChannel: CounsellingChannelApi get() = CounsellingChannelApi(client)
