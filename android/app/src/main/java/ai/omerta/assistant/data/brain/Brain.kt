package ai.omerta.assistant.data.brain

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The portable "brain" file (`*.brain`, JSON, format `omerta-brain/1`).
 *
 * A brain is everything that makes the assistant *yours* and works with no network:
 *  - [persona]   — name, personality traits, tone, greeting, speaking style
 *  - [knowledge] — facts/notes/documents you taught it (retrieved offline, BM25)
 *  - [reflexes]  — "when I say X, you say Y" trained replies
 *  - [lessons]   — standing rules it must follow
 *  - [profile]   — what it knows about *you* (name, likes, …)
 *
 * Brains are created in-app (Brain screen / chat teaching), or on a PC with
 * `brain/omerta_brain.py`, and moved between devices by export/import.
 */
@Serializable
data class BrainFile(
    val format: String = FORMAT,
    val id: String,
    val name: String,
    val version: Int = 1,
    val author: String = "",
    val description: String = "",
    val persona: Persona = Persona(),
    val knowledge: List<KnowledgeItem> = emptyList(),
    val reflexes: List<Reflex> = emptyList(),
    val lessons: List<BrainLesson> = emptyList(),
    val profile: Map<String, String> = emptyMap(),
    val model: ModelHint? = null,
    val stats: BrainStats = BrainStats(),
    val created: Long = 0,
    val updated: Long = 0,
) {
    companion object {
        const val FORMAT = "omerta-brain/1"

        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            prettyPrint = true
            isLenient = true
        }

        fun parse(text: String): BrainFile {
            val b = json.decodeFromString(serializer(), text)
            require(b.format.startsWith("omerta-brain/")) { "not an Omerta brain (format=${b.format})" }
            return b
        }
    }

    fun encode(): String = json.encodeToString(serializer(), this)
}

@Serializable
data class Persona(
    val name: String = "Omerta",
    val tagline: String = "your offline operator brain",
    val greeting: String = "Online. Offline. Doesn't matter — I'm here. What do you need?",
    /** Free-form character description — becomes the core of the system prompt. */
    val description: String = "A loyal, sharp, slightly dry-humored assistant that lives on the device.",
    val traits: List<String> = listOf("loyal", "precise", "calm", "dry humor"),
    /** calm | friendly | playful | serious | sarcastic | mentor | hype */
    val tone: String = "calm",
    /** short | medium | long */
    val verbosity: String = "medium",
    val speakingStyle: List<String> = emptyList(),
    val catchphrases: List<String> = emptyList(),
    /** Said when it has no idea. Rotated. */
    val fallbacks: List<String> = emptyList(),
    val signoff: String = "",
    val emoji: Boolean = false,
    /** 0..1 — how often catchphrases/personality flourishes are added. */
    val flair: Double = 0.35,
    /** Optional full override of the generated system prompt. */
    val systemPrompt: String = "",
    /** Per-brain highlight accent (hex). Blank = the OMERTA amber. UI base stays amber. */
    val accent: String = "",
)

@Serializable
data class KnowledgeItem(
    val id: String,
    val topic: String = "",
    val text: String,
    val tags: List<String> = emptyList(),
    val source: String = "taught",
    val ts: Long = 0,
    /** Boost for retrieval ranking; corrections get > 1. */
    val weight: Double = 1.0,
)

@Serializable
data class Reflex(
    val id: String,
    val patterns: List<String>,
    val replies: List<String>,
)

@Serializable
data class BrainLesson(val id: String, val text: String, val ts: Long = 0)

@Serializable
data class ModelHint(
    /** Suggested on-device model file name, e.g. gemma3-1b-it-int4.task */
    val file: String = "",
    val url: String = "",
    /** auto | gemma | chatml | phi | llama3 | raw */
    val promptFormat: String = "auto",
    val temperature: Double = 0.7,
)

@Serializable
data class BrainStats(
    val conversations: Int = 0,
    val messages: Int = 0,
    val taught: Int = 0,
    val corrections: Int = 0,
)
