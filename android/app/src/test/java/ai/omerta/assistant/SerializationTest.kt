package ai.omerta.assistant

import ai.omerta.assistant.data.model.ChatRequest
import ai.omerta.assistant.data.model.ChatResponse
import ai.omerta.assistant.data.model.WireMessage
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SerializationTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    @Test
    fun chatRequest_roundtrips() {
        val req = ChatRequest(
            messages = listOf(WireMessage("user", "hello")),
            model = "claude-opus-5", system = "sys", effort = "high", stream = true,
        )
        val encoded = json.encodeToString(ChatRequest.serializer(), req)
        assertTrue(encoded.contains("\"model\":\"claude-opus-5\""))
        val decoded = json.decodeFromString(ChatRequest.serializer(), encoded)
        assertEquals(req, decoded)
    }

    @Test
    fun chatResponse_ignoresUnknownKeys() {
        val payload = """
            {"content":"hi","model":"claude-opus-5","stop_reason":"end_turn",
             "usage":{"input_tokens":10,"output_tokens":5},"extra":"ignored"}
        """.trimIndent()
        val decoded = json.decodeFromString(ChatResponse.serializer(), payload)
        assertEquals("hi", decoded.content)
        assertEquals(5, decoded.usage?.outputTokens)
    }
}
