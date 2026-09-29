package ai.omerta.assistant.data.brain

import kotlin.math.ln

/** Tokenising, light stemming and BM25 retrieval — all pure Kotlin, fully offline. */
object TextKit {

    val STOP = setOf(
        "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in", "on", "at", "for",
        "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being", "am",
        "do", "does", "did", "doing", "have", "has", "had", "it", "its", "this", "that", "these",
        "those", "there", "here", "what", "which", "who", "whom", "whose", "when", "where", "why",
        "how", "can", "could", "would", "should", "will", "shall", "may", "might", "must",
        "i", "me", "you", "your", "yours", "we", "us", "our", "they", "them", "their", "he",
        "him", "his", "she", "her", "hers", "so", "not", "no", "yes", "just", "about", "into",
        "tell", "know", "please", "some", "any", "all", "more", "much", "very", "really",
        "whats", "what's", "hows", "ok", "okay", "hey", "u", "ur", "im", "i'm", "does", "s",
        "explain", "describe", "give", "show", "say",
    )

    private val nonWord = Regex("[^\\p{L}\\p{N}'#+.-]+")

    fun normalize(s: String): String =
        s.lowercase().replace(Regex("[^\\p{L}\\p{N}\\s']"), " ").replace(Regex("\\s+"), " ").trim()

    fun words(s: String): List<String> =
        s.lowercase().split(nonWord).map { it.trim('\'', '.', '-') }.filter { it.isNotEmpty() }

    /** Content tokens: lower-cased, stop-words removed, lightly stemmed. */
    fun tokens(s: String): List<String> = words(s).filter { it !in STOP }.map(::stem)

    fun stem(w: String): String {
        if (w.length <= 3 || w.any { it.isDigit() }) return w
        return when {
            w.endsWith("ies") && w.length > 4 -> w.dropLast(3) + "y"
            w.endsWith("sses") -> w.dropLast(2)
            w.endsWith("ing") && w.length > 5 -> w.dropLast(3)
            w.endsWith("ed") && w.length > 4 -> w.dropLast(2)
            w.endsWith("'s") -> w.dropLast(2)
            w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") -> w.dropLast(1)
            else -> w
        }
    }

    fun sentences(text: String): List<String> =
        text.split(Regex("(?<=[.!?])\\s+|\\n+")).map { it.trim() }.filter { it.isNotEmpty() }

    /** Rewrites a user-taught first-person fact so the brain can say it back ("my" → "your"). */
    fun flipPerspective(s: String): String {
        val map = mapOf(
            "i am" to "you are", "i'm" to "you're", "i was" to "you were", "i have" to "you have",
            "i've" to "you've", "i" to "you", "me" to "you", "my" to "your", "mine" to "yours",
            "myself" to "yourself", "am" to "are",
        )
        val out = StringBuilder()
        val parts = s.split(" ")
        var i = 0
        while (i < parts.size) {
            val w = parts[i]
            val core = w.lowercase().trimEnd(',', '.', '!', '?', ';', ':')
            val trail = w.substring(w.trimEnd(',', '.', '!', '?', ';', ':').length)
            val two = if (i + 1 < parts.size) "$core ${parts[i + 1].lowercase().trimEnd(',', '.', '!', '?')}" else null
            val rep2 = two?.let { map[it] }
            if (rep2 != null) {
                val t2 = parts[i + 1].substring(parts[i + 1].trimEnd(',', '.', '!', '?').length)
                out.append(matchCase(parts[i], rep2)).append(t2).append(' ')
                i += 2; continue
            }
            // Only flip "am" when it follows a subject we already flipped.
            val rep = map[core]?.takeIf { core != "am" }
            if (rep != null) out.append(matchCase(w, rep)).append(trail).append(' ') else out.append(w).append(' ')
            i++
        }
        return out.toString().trim()
    }

    private fun matchCase(src: String, rep: String) =
        if (src.firstOrNull()?.isUpperCase() == true) rep.replaceFirstChar { it.uppercase() } else rep

    fun jaccard(a: Collection<String>, b: Collection<String>): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val sa = a.toSet(); val sb = b.toSet()
        return sa.intersect(sb).size.toDouble() / sa.union(sb).size
    }

    /** Break long documents into retrievable chunks on paragraph/sentence boundaries. */
    fun chunk(text: String, maxChars: Int = 700): List<String> {
        val paras = text.replace("\r", "").split(Regex("\\n\\s*\\n")).map { it.trim() }.filter { it.isNotEmpty() }
        val out = mutableListOf<String>()
        val cur = StringBuilder()
        fun flush() { if (cur.isNotBlank()) out.add(cur.toString().trim()); cur.clear() }
        for (p in paras) {
            if (p.length > maxChars) {
                flush()
                for (s in sentences(p)) {
                    if (cur.length + s.length > maxChars) flush()
                    cur.append(s).append(' ')
                }
                flush()
            } else {
                if (cur.length + p.length > maxChars) flush()
                cur.append(p).append("\n\n")
            }
        }
        flush()
        return out
    }

    /** Character trigrams (over the normalized string) for fuzzy/paraphrase matching. */
    fun trigrams(s: String): Set<String> {
        val n = " " + normalize(s) + " "
        if (n.length < 3) return setOf(n)
        return (0..n.length - 3).map { n.substring(it, it + 3) }.toSet()
    }

    /** 0..1 similarity blending token Jaccard and character-trigram Jaccard (typo/paraphrase tolerant). */
    fun fuzzySimilarity(a: String, b: String): Double {
        val tok = jaccard(tokens(a), tokens(b))
        val tri = jaccard(trigrams(a), trigrams(b))
        return 0.55 * tok + 0.45 * tri
    }
}

/** Okapi BM25 over the brain's knowledge. Topic and tags are weighted above body text. */
class Bm25Index(private val docs: List<KnowledgeItem>) {
    private val k1 = 1.4
    private val b = 0.75
    private val docTokens: List<List<String>> = docs.map {
        val topic = TextKit.tokens(it.topic)
        val tags = it.tags.flatMap(TextKit::tokens)
        topic + topic + tags + TextKit.tokens(it.text)
    }
    private val avgLen = docTokens.map { it.size }.average().takeIf { !it.isNaN() && it > 0 } ?: 1.0
    private val df: Map<String, Int> = HashMap<String, Int>().also { m ->
        docTokens.forEach { t -> t.toSet().forEach { m[it] = (m[it] ?: 0) + 1 } }
    }

    data class Hit(val item: KnowledgeItem, val score: Double, val coverage: Double)

    fun idf(term: String): Double {
        val n = df[term] ?: 0
        return ln(1 + (docs.size - n + 0.5) / (n + 0.5))
    }

    fun search(query: String, limit: Int = 5): List<Hit> {
        val q = TextKit.tokens(query).distinct()
        if (q.isEmpty() || docs.isEmpty()) return emptyList()
        val hits = mutableListOf<Hit>()
        docTokens.forEachIndexed { i, toks ->
            if (toks.isEmpty()) return@forEachIndexed
            val tf = toks.groupingBy { it }.eachCount()
            var score = 0.0
            var matched = 0
            for (term in q) {
                val f = tf[term] ?: continue
                matched++
                score += idf(term) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks.size / avgLen))
            }
            if (matched > 0) hits.add(Hit(docs[i], score * docs[i].weight, matched.toDouble() / q.size))
        }
        return hits.sortedByDescending { it.score }.take(limit)
    }
}
