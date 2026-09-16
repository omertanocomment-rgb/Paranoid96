package ai.omerta.assistant.data.model

import java.util.UUID

/** UI-facing chat item with local state (streaming, error, timestamps). */
data class ChatItem(
    val id: String = UUID.randomUUID().toString(),
    val role: String,
    val content: String,
    val streaming: Boolean = false,
    val isError: Boolean = false,
    val timestamp: Long = System.currentTimeMillis(),
) {
    fun toWire(): WireMessage = WireMessage(role = role, content = content)
}
