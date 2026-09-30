package ai.omerta.assistant.data.brain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Opt-in web lookup for the offline brain: when the brain doesn't know an answer and the
 * operator has enabled it, look the question up online. Uses privacy-respecting,
 * key-free sources — DuckDuckGo's Instant Answer API, then Wikipedia's summary API — and
 * returns a short answer with its source. Off by default so the offline promise holds.
 */
class WebSearch(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    data class Result(val text: String, val source: String)

    suspend fun search(query: String): Result? {
        val q = query.trim().ifBlank { return null }
        instantAnswer(q)?.let { return it }
        return wikipedia(q)
    }

    private fun get(url: String): String? = runCatching {
        client.newCall(Request.Builder().url(url).header("User-Agent", "OmertaAI/1.0").get().build())
            .execute().use { r -> if (r.isSuccessful) r.body?.string() else null }
    }.getOrNull()

    private fun instantAnswer(q: String): Result? {
        val enc = URLEncoder.encode(q, "UTF-8")
        val body = get("https://api.duckduckgo.com/?q=$enc&format=json&no_html=1&skip_disambig=1") ?: return null
        return parseDuckDuckGo(body)
    }

    private fun wikipedia(q: String): Result? {
        val title = URLEncoder.encode(q.trim().trimEnd('?', '.', '!').replace(' ', '_'), "UTF-8")
        val body = get("https://en.wikipedia.org/api/rest_v1/page/summary/$title") ?: return null
        return parseWikipedia(body)
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** Pure parse of a DuckDuckGo Instant Answer JSON body → a short answer, or null. */
        fun parseDuckDuckGo(body: String): Result? = runCatching {
            val root = json.parseToJsonElement(body).jsonObject
            fun str(k: String) = root[k]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
            val answer = str("Answer") ?: str("AbstractText") ?: str("Definition")
            if (answer != null) {
                val src = str("AbstractURL") ?: str("DefinitionURL") ?: "DuckDuckGo"
                return@runCatching Result(answer.trim(), src)
            }
            // First related-topic text as a last resort.
            root["RelatedTopics"]?.jsonArray?.firstNotNullOfOrNull {
                it.jsonObject["Text"]?.jsonPrimitive?.content?.takeIf { t -> t.isNotBlank() }
            }?.let { return@runCatching Result(it.trim(), "DuckDuckGo") }
            null
        }.getOrNull()

        /** Pure parse of a Wikipedia REST summary JSON body → a short answer, or null. */
        fun parseWikipedia(body: String): Result? = runCatching {
            val root = json.parseToJsonElement(body).jsonObject
            val extract = root["extract"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: return@runCatching null
            val type = root["type"]?.jsonPrimitive?.content
            if (type == "disambiguation") return@runCatching null
            val url = root["content_urls"]?.jsonObject?.get("desktop")?.jsonObject
                ?.get("page")?.jsonPrimitive?.content ?: "Wikipedia"
            Result(extract.trim().take(600), url)
        }.getOrNull()
    }
}
