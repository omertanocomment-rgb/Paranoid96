package ai.omerta.assistant.data.brain

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.random.Random

/** One reply from the offline brain. */
data class BrainReply(
    val text: String,
    val kind: Kind,
    /** True when the brain itself changed (taught/forgot/corrected) and must be saved. */
    val changed: Boolean = false,
    val sources: List<String> = emptyList(),
) {
    enum class Kind { TAUGHT, REFLEX, SKILL, KNOWLEDGE, SMALLTALK, FALLBACK }

    /** Whether an on-device LLM (when present) should take over and answer instead. */
    val deferToModel: Boolean get() = kind == Kind.FALLBACK
}

/**
 * The offline brain: a deterministic, dependency-free conversational engine.
 *
 * Pipeline per message:
 *  1. **Teaching** — natural-language teaching ("remember that…", "when I say X say Y",
 *     "your name is…", "call me…", "be more…", "always…", "that's wrong, it's…", "forget…").
 *  2. **Reflexes** — trained replies for exact/fuzzy trigger phrases.
 *  3. **Skills** — identity, small talk, math, date/time, "what do you know", jokes.
 *  4. **Knowledge** — BM25 retrieval over everything taught / imported.
 *  5. **Fallback** — in-character "I don't know yet — teach me".
 *
 * Every reply is shaped by the [Persona] (tone, verbosity, flair, catchphrases, sign-off).
 * The same brain also produces a system prompt + retrieved context for an on-device
 * LLM or an online model ([systemPrompt]), so personality and knowledge carry across
 * every engine.
 */
class BrainEngine(
    brain: BrainFile,
    private val clock: () -> Long = System::currentTimeMillis,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val rnd: Random = Random.Default,
) {
    var brain: BrainFile = brain
        private set

    private var index: Bm25Index = Bm25Index(brain.knowledge)
    private var lastUserInput: String? = null
    private var lastQuery: String? = null
    private val shownForQuery = mutableSetOf<String>()

    fun replace(newBrain: BrainFile) {
        brain = newBrain; reindex(); lastUserInput = null; lastQuery = null; shownForQuery.clear()
    }

    private fun reindex() { index = Bm25Index(brain.knowledge) }

    private fun mutate(f: (BrainFile) -> BrainFile) {
        brain = f(brain).copy(updated = clock()); reindex()
    }

    private fun newId(prefix: String) =
        prefix + java.lang.Long.toString(clock(), 36) + java.lang.Long.toString(rnd.nextLong(1_000_000L), 36)

    // ------------------------------------------------------------------ public API

    fun respond(rawInput: String): BrainReply {
        val input = rawInput.trim()
        if (input.isEmpty()) return BrainReply(style(brain.persona.greeting), BrainReply.Kind.SMALLTALK)
        mutateStats { it.copy(messages = it.messages + 1) }
        val reply = teach(input) ?: reflex(input) ?: skill(input) ?: knowledge(input) ?: fallback(input)
        if (reply.kind != BrainReply.Kind.TAUGHT) lastUserInput = input
        return reply
    }

    fun greeting(): String = style(brain.persona.greeting, allowFlair = false)

    /** Adds a document/notes to the knowledge base, chunked for retrieval. Returns chunks added. */
    fun learnDocument(text: String, source: String, topic: String = ""): Int {
        val chunks = TextKit.chunk(text)
        if (chunks.isEmpty()) return 0
        val now = clock()
        val items = chunks.mapIndexed { i, c ->
            KnowledgeItem(
                id = newId("k"), topic = topic.ifBlank { guessTopic(c) }, text = c,
                tags = listOf("doc"), source = "$source#${i + 1}", ts = now,
            )
        }
        mutate { it.copy(knowledge = it.knowledge + items) }
        mutateStats { it.copy(taught = it.taught + items.size) }
        return items.size
    }

    fun addFact(text: String, topic: String = "", tags: List<String> = emptyList(), weight: Double = 1.0): KnowledgeItem {
        val t = text.trim().trimEnd('.') + "."
        val item = KnowledgeItem(newId("k"), topic.ifBlank { guessTopic(t) }, t, tags, "taught", clock(), weight)
        mutate { it.copy(knowledge = it.knowledge + item) }
        mutateStats { it.copy(taught = it.taught + 1) }
        return item
    }

    /**
     * Learns *how the operator talks* and gently mirrors it: emoji use, message length
     * (→ answer length), and an enthusiastic/terse lean (→ tone). Signals accumulate in
     * hidden `_style_*` profile keys and the persona is nudged every few messages, so the
     * brain grows into your voice without ever overwriting a personality you set by hand.
     */
    fun observeUser(text: String) {
        val words = TextKit.words(text).size
        val emoji = text.codePoints().filter { it in 0x1F000..0x1FAFF || it in 0x2600..0x27BF }.count().toInt()
        val excited = text.count { it == '!' } + Regex("\\b(lol|omg|haha|yay|awesome|love it)\\b", RegexOption.IGNORE_CASE).findAll(text).count()
        fun bump(k: String, by: Int) { setProfileRaw(k, ((brain.profile[k]?.toIntOrNull() ?: 0) + by).toString()) }
        bump("_style_msgs", 1)
        if (emoji > 0) bump("_style_emoji", 1)
        bump("_style_words", words)
        if (excited > 0) bump("_style_excited", 1)
        val n = brain.profile["_style_msgs"]?.toIntOrNull() ?: 0
        if (n < 6 || n % 4 != 0) return
        val emojiRate = (brain.profile["_style_emoji"]?.toIntOrNull() ?: 0).toDouble() / n
        val avgWords = (brain.profile["_style_words"]?.toIntOrNull() ?: 0).toDouble() / n
        val excitedRate = (brain.profile["_style_excited"]?.toIntOrNull() ?: 0).toDouble() / n
        val p = brain.persona
        val verbosity = when { avgWords <= 6 -> "short"; avgWords >= 24 -> "long"; else -> p.verbosity }
        val tone = if (excitedRate >= 0.5 && p.tone in listOf("calm", "serious", "friendly")) "playful" else p.tone
        val emojiOn = if (emojiRate >= 0.4) true else p.emoji
        if (verbosity != p.verbosity || tone != p.tone || emojiOn != p.emoji)
            mutate { it.copy(persona = p.copy(verbosity = verbosity, tone = tone, emoji = emojiOn)) }
    }

    fun addReflex(pattern: String, reply: String): Reflex {
        val norm = TextKit.normalize(pattern)
        val existing = brain.reflexes.firstOrNull { r -> r.patterns.any { TextKit.normalize(it) == norm } }
        val r = if (existing != null) existing.copy(replies = (existing.replies + reply).distinct())
        else Reflex(newId("r"), listOf(pattern.trim()), listOf(reply.trim()))
        mutate { b -> b.copy(reflexes = b.reflexes.filterNot { it.id == r.id } + r) }
        mutateStats { it.copy(taught = it.taught + 1) }
        return r
    }

    fun addLesson(text: String): BrainLesson {
        val l = BrainLesson(newId("l"), text.trim(), clock())
        mutate { it.copy(lessons = it.lessons + l) }
        mutateStats { it.copy(taught = it.taught + 1) }
        return l
    }

    fun updatePersona(p: Persona) = mutate { it.copy(persona = p) }
    fun rename(name: String) = mutate { it.copy(name = name) }

    fun removeKnowledge(id: String) = mutate { b -> b.copy(knowledge = b.knowledge.filterNot { it.id == id }) }
    fun removeReflex(id: String) = mutate { b -> b.copy(reflexes = b.reflexes.filterNot { it.id == id }) }
    fun removeLesson(id: String) = mutate { b -> b.copy(lessons = b.lessons.filterNot { it.id == id }) }
    fun setProfile(key: String, value: String?) = mutate { b ->
        b.copy(profile = if (value == null) b.profile - key else b.profile + (key to value))
    }

    /** Set a profile key without reindexing (used for hidden `_style_*` counters). */
    private fun setProfileRaw(key: String, value: String) {
        brain = brain.copy(profile = brain.profile + (key to value), updated = clock())
    }

    /** Visible profile entries (hides internal `_`-prefixed counters). */
    fun visibleProfile(): Map<String, String> = brain.profile.filterKeys { !it.startsWith("_") }

    fun newConversation() {
        lastUserInput = null; lastQuery = null; shownForQuery.clear()
        mutateStats { it.copy(conversations = it.conversations + 1) }
    }

    /**
     * System prompt for an LLM (on-device or online) carrying this brain's personality,
     * rules, user profile and the knowledge most relevant to [forInput].
     */
    fun systemPrompt(forInput: String? = null, maxKnowledge: Int = 5): String {
        val p = brain.persona
        val sb = StringBuilder()
        if (p.systemPrompt.isNotBlank()) sb.append(p.systemPrompt.trim()).append("\n\n")
        else {
            sb.append("You are ${p.name}, ${p.tagline}.\n")
            if (p.description.isNotBlank()) sb.append(p.description.trim()).append('\n')
            if (p.traits.isNotEmpty()) sb.append("Personality: ${p.traits.joinToString(", ")}.\n")
            sb.append("Tone: ${p.tone}. Answer length: ${p.verbosity}.")
            if (p.emoji) sb.append(" You may use emoji.") else sb.append(" Do not use emoji.")
            sb.append('\n')
            if (p.speakingStyle.isNotEmpty()) sb.append("Style: ${p.speakingStyle.joinToString("; ")}.\n")
            if (p.catchphrases.isNotEmpty()) sb.append("Catchphrases you sometimes use: ${p.catchphrases.joinToString(" | ")}.\n")
            sb.append("Stay in character. Never claim to be any other assistant.\n\n")
        }
        if (brain.lessons.isNotEmpty()) {
            sb.append("Rules you were taught (always follow):\n")
            brain.lessons.forEach { sb.append("- ${it.text}\n") }
            sb.append('\n')
        }
        val profile = visibleProfile()
        if (profile.isNotEmpty()) {
            sb.append("About the user:\n")
            profile.forEach { (k, v) -> sb.append("- $k: $v\n") }
            sb.append('\n')
        }
        val hits = forInput?.let { index.search(it, maxKnowledge) }.orEmpty()
        if (hits.isNotEmpty()) {
            sb.append("Relevant things you were taught (prefer these over guesses; ")
            sb.append("\"I/my\" in them refers to the user):\n")
            hits.forEach { sb.append("- ${it.item.text.take(800)}\n") }
        }
        return sb.toString().trim()
    }

    // ------------------------------------------------------------------ 1. teaching

    private val rxRemember = Regex("^(?:please\\s+)?(?:remember|memori[sz]e|note|learn|fact)(?:\\s+that)?\\s*[:,-]?\\s+(.+)$", RegexOption.IGNORE_CASE)
    private val rxReflex = Regex(
        "^(?:when|if|whenever)\\s+(?:i|someone|anyone)\\s+(?:say|says|ask|asks|type|types|write|writes)\\s+[\"“']?(.+?)[\"”']?\\s*,?\\s+(?:then\\s+)?(?:you\\s+)?(?:should\\s+)?(?:say|reply|respond|answer)(?:\\s+with)?\\s*[:,]?\\s+[\"“']?(.+?)[\"”']?\\s*$",
        RegexOption.IGNORE_CASE,
    )
    private val rxQA = Regex("^q\\s*:\\s*(.+?)\\s*(?:\\||\\n)\\s*a\\s*:\\s*(.+)$", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
    private val rxYourName = Regex("^(?:your name is|i(?:'ll| will) call you|call yourself|you are called|you're called)\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE)
    private val rxMyName = Regex("^(?:my name is|call me|i am called|i'm called|you can call me)\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE)
    private val rxMore = Regex("^(?:be more|act more|you are now|you're now|from now on,? (?:you are|be)|be)\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE)
    private val rxLess = Regex("^(?:be less|stop being|don'?t be)\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE)
    private val rxRule = Regex("^(?:always|never|rule\\s*:|from now on,?)\\s*(.+)$", RegexOption.IGNORE_CASE)
    private val rxLike = Regex("^i\\s+(like|love|hate|dislike|prefer|enjoy|live in|work as|work at|work in|study|am from|was born in|was born on)\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE)
    private val rxMy = Regex("^my\\s+([\\w' -]{1,40}?)\\s+(?:is|are|was)\\s+(.+?)[.!]?$", RegexOption.IGNORE_CASE)
    private val rxWrong = Regex(
        "^(?:wrong|that'?s wrong|incorrect|that'?s incorrect|not right|that'?s not right|not quite|nope)\\b[\\s,.!:-]*" +
            "(?:(?:the\\s+)?(?:correct\\s+|right\\s+|real\\s+)?answer\\s+is|it'?s|it\\s+is|actually|say)?\\s*[:,-]?\\s*(.*)$",
        RegexOption.IGNORE_CASE,
    )
    private val rxNoItIs = Regex("^no[,!.]?\\s+(?:the\\s+(?:correct\\s+|right\\s+)?answer\\s+is|it'?s|it\\s+is|actually)\\s+(.+)$", RegexOption.IGNORE_CASE)
    private val rxForget = Regex("^(?:forget|unlearn)\\s+(?:about\\s+|that\\s+|everything about\\s+)?(.+?)[.!]?$", RegexOption.IGNORE_CASE)

    private fun teach(input: String): BrainReply? {
        val p = brain.persona

        rxQA.find(input)?.let { m ->
            addReflex(m.groupValues[1], m.groupValues[2])
            addFact(m.groupValues[2], topic = m.groupValues[1], tags = listOf("qa"))
            return taught(ack("Q&A stored", "Ask me \"${m.groupValues[1].trim()}\" anytime."))
        }
        rxReflex.find(input)?.let { m ->
            val trig = m.groupValues[1].trim(); val rep = m.groupValues[2].trim()
            if (trig.isNotEmpty() && rep.isNotEmpty()) {
                addReflex(trig, rep)
                return taught(ack("Trained", "When you say \"$trig\", I'll say \"$rep\"."))
            }
        }
        rxYourName.find(input)?.let { m ->
            val n = cleanName(m.groupValues[1])
            updatePersona(p.copy(name = n))
            return taught(style("$n it is. That's who I am now."))
        }
        rxMyName.find(input)?.let { m ->
            val n = cleanName(m.groupValues[1])
            setProfile("name", n)
            return taught(style("Got it — you're $n. I won't forget."))
        }
        rxLess.find(input)?.let { m ->
            val t = m.groupValues[1].trim().lowercase()
            updatePersona(p.copy(traits = p.traits.filterNot { it.equals(t, true) }))
            addLesson("Do not be $t.")
            return taught(style("Understood. Dialing \"$t\" down."))
        }
        rxMore.find(input)?.let { m ->
            val t = m.groupValues[1].trim().lowercase()
            // Only accept short trait-like phrases ("be more sarcastic"), not commands ("be careful with X").
            val bare = !Regex("^(be more|act more|you are now|you're now|from now on)", RegexOption.IGNORE_CASE).containsMatchIn(input)
            val maxWords = if (bare) 1 else 3
            if (t.split(" ").size <= maxWords && t.isNotEmpty() && !t.startsWith("a ") && Regex("^[\\p{L} -]+$").matches(t)) {
                val tone = TONES.firstOrNull { t.contains(it) }
                updatePersona(p.copy(traits = (p.traits + t).distinct(), tone = tone ?: p.tone))
                return taught(style("Noted. More $t from here on."))
            }
        }
        rxRule.find(input)?.let { m ->
            // "never mind" / "always here" are chat, not rules — require a real instruction.
            if (m.groupValues[1].isNotBlank() && input.trim().split(Regex("\\s+")).size >= 3 && !input.trim().endsWith("?")) {
                val rule = input.trim().removePrefix("rule:").removePrefix("Rule:").trim()
                addLesson(rule.replaceFirstChar { it.uppercase() })
                return taught(ack("Rule locked in", "\"$rule\""))
            }
        }
        (rxWrong.find(input) ?: rxNoItIs.find(input))?.let { m ->
            val better = m.groupValues[1].trim()
            val q = lastUserInput
            if (q == null) return taught(style("Wrong about what? Ask me something first, then correct me."), changed = false)
            if (better.isEmpty()) return taught(style("Then teach me. Say: \"the answer is …\""), changed = false)
            addReflex(q, better)
            addFact(better, topic = q, tags = listOf("correction"), weight = 2.0)
            mutateStats { it.copy(corrections = it.corrections + 1) }
            return taught(ack("Corrected", "Next time you ask \"$q\", I'll say: $better"))
        }
        rxForget.find(input)?.let { m ->
            val what = m.groupValues[1].trim()
            if (what.equals("everything", true) || what.equals("all", true)) {
                return taught(style("I won't wipe myself from chat. Use the Brain screen → Reset if you mean it."), changed = false)
            }
            val removed = forgetMatching(what)
            return taught(
                if (removed == 0) style("I don't have anything about \"$what\".")
                else ack("Forgotten", "$removed item(s) about \"$what\"."),
                changed = removed > 0,
            )
        }
        rxMy.find(input)?.let { m ->
            val key = m.groupValues[1].trim().lowercase()
            if (key !in setOf("name")) {
                setProfile(key, m.groupValues[2].trim())
                addFact(input, topic = "my $key", tags = listOf("profile"))
                return taught(style("Your $key is ${m.groupValues[2].trim()}. Stored."))
            } else {
                setProfile("name", cleanName(m.groupValues[2]))
                return taught(style("Got it — you're ${cleanName(m.groupValues[2])}."))
            }
        }
        rxLike.find(input)?.let { m ->
            val verb = m.groupValues[1].lowercase(); val what = m.groupValues[2].trim()
            val key = verb.replace(" ", "_")
            val prev = brain.profile[key]
            setProfile(key, if (prev.isNullOrBlank()) what else "$prev; $what")
            addFact(input, topic = "me $verb", tags = listOf("profile"))
            return taught(style("Noted — you $verb $what."))
        }
        rxRemember.find(input)?.let { m ->
            val fact = m.groupValues[1].trim()
            if (fact.isNotEmpty() && !fact.endsWith("?") && !Regex("^(when|if|how|what|who|me)\\b", RegexOption.IGNORE_CASE).containsMatchIn(fact)) {
                val item = addFact(fact)
                return taught(ack("Learned", item.text))
            }
        }
        return null
    }

    private fun forgetMatching(what: String): Int {
        val toks = TextKit.tokens(what).toSet()
        if (toks.isEmpty()) return 0
        fun matches(s: String) = TextKit.tokens(s).toSet().containsAll(toks)
        val before = brain.knowledge.size + brain.reflexes.size + brain.lessons.size
        mutate { b ->
            b.copy(
                knowledge = b.knowledge.filterNot { matches(it.topic + " " + it.text) },
                reflexes = b.reflexes.filterNot { r -> r.patterns.any(::matches) },
                lessons = b.lessons.filterNot { matches(it.text) },
            )
        }
        return before - (brain.knowledge.size + brain.reflexes.size + brain.lessons.size)
    }

    private fun taught(text: String, changed: Boolean = true) = BrainReply(text, BrainReply.Kind.TAUGHT, changed)

    private fun ack(head: String, detail: String): String {
        val lead = when (brain.persona.tone) {
            "playful" -> "Ooh, noted!"
            "hype" -> "LOCKED IN!"
            "sarcastic" -> "Fine, I'll remember that."
            "mentor" -> "Good lesson."
            "friendly" -> "Got it!"
            else -> "✓ $head."
        }
        return style("$lead $detail", allowFlair = false)
    }

    private fun cleanName(s: String) = s.trim().trim('"', '\'', '.', '!').split(" ").take(4)
        .joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }

    // ------------------------------------------------------------------ 2. reflexes

    private fun reflex(input: String): BrainReply? {
        val norm = TextKit.normalize(input)
        val toks = TextKit.words(norm)
        var best: Pair<Reflex, Double>? = null
        for (r in brain.reflexes) for (pat in r.patterns) {
            val pn = TextKit.normalize(pat)
            val score = when {
                pn.isEmpty() -> 0.0
                pat.trim().endsWith("*") && norm.startsWith(TextKit.normalize(pat.trimEnd('*'))) -> 0.95
                pn == norm -> 1.0
                else -> {
                    val pt = TextKit.words(pn)
                    if (pt.size >= 2) TextKit.jaccard(pt, toks) else 0.0
                }
            }
            if (score > (best?.second ?: 0.0)) best = r to score
        }
        val (r, score) = best ?: return null
        if (score < 0.72 || r.replies.isEmpty()) return null
        return BrainReply(fill(r.replies.random(rnd)), BrainReply.Kind.REFLEX)
    }

    private fun fill(s: String): String {
        val t = Instant.ofEpochMilli(clock()).atZone(zone)
        return s.replace("{name}", brain.profile["name"] ?: "friend")
            .replace("{me}", brain.persona.name)
            .replace("{time}", t.format(DateTimeFormatter.ofPattern("HH:mm")))
            .replace("{date}", t.format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH)))
    }

    // ------------------------------------------------------------------ 3. skills

    private fun skill(input: String): BrainReply? {
        val n = TextKit.normalize(input)
        val p = brain.persona
        val user = brain.profile["name"]

        fun say(s: String, kind: BrainReply.Kind = BrainReply.Kind.SKILL) = BrainReply(style(s), kind)

        if (Regex("^(hi|hello|hey|yo|hiya|howdy|sup|greetings|good (morning|afternoon|evening))( there)?( ${Regex.escape(p.name.lowercase())})?$").matches(n))
            return BrainReply(style(greetLine(user)), BrainReply.Kind.SMALLTALK)
        if (Regex("^(how are you|how r u|how are u|how's it going|hows it going|how you doing|what's up|whats up|wassup)( today)?$").matches(n))
            return BrainReply(style(moodLine()), BrainReply.Kind.SMALLTALK)
        if (Regex("^(thanks|thank you|thx|ty|cheers|appreciate it|thank u)( so much| a lot)?( ${Regex.escape(p.name.lowercase())})?$").matches(n))
            return BrainReply(style(thanksLine()), BrainReply.Kind.SMALLTALK)
        if (Regex("^(bye|goodbye|good night|goodnight|see you|see ya|later|cya|gn)( later)?$").matches(n))
            return BrainReply(style(p.signoff.ifBlank { byeLine(user) }, allowFlair = false), BrainReply.Kind.SMALLTALK)

        if (Regex("^(who are you|what are you|what is your name|what's your name|whats your name|introduce yourself|tell me about yourself)$").matches(n))
            return say(intro())
        if (Regex("^(what is my name|what's my name|whats my name|who am i|do you know my name|do you know me)$").matches(n))
            return say(if (user != null) "You're $user." + profileSummary(short = true)
                       else "You haven't told me yet. Say \"my name is …\".")
        if (Regex("^(what do you know|what have you learned|what did you learn|what do you remember|show your memory|what have i taught you)$").matches(n))
            return say(memorySummary())
        if (Regex("^(help|what can you do|commands|how do i teach you|how do i use you)$").matches(n))
            return say(helpText())
        if (Regex("^(what time is it|what's the time|whats the time|time|current time|tell me the time)( now)?$").matches(n))
            return say("It's ${Instant.ofEpochMilli(clock()).atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm"))}.")
        if (Regex("^(what day is it|what is the date|what's the date|whats the date|what is today|what's today|whats today|today's date|todays date|date)( today)?$").matches(n))
            return say("Today is ${Instant.ofEpochMilli(clock()).atZone(zone).format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy", Locale.ENGLISH))}.")
        if (Regex("^(tell me a joke|joke|say something funny|make me laugh)$").matches(n)) {
            val taughtJokes = brain.knowledge.filter { "joke" in it.tags || it.topic.contains("joke", true) }
            val j = taughtJokes.randomOrNull(rnd)?.text ?: JOKES.random(rnd)
            return BrainReply(style(j), BrainReply.Kind.SMALLTALK)
        }
        if (Regex("^(tell me more|more|go on|continue|and|what else|elaborate)$").matches(n)) {
            val q = lastQuery ?: return say("More about what? Ask me something first.")
            val next = index.search(q, 8).firstOrNull { it.item.id !in shownForQuery && it.coverage >= 0.34 }
                ?: return say("That's everything I know about that. Teach me more with \"remember that …\".")
            shownForQuery += next.item.id
            return BrainReply(style(render(next.item)), BrainReply.Kind.KNOWLEDGE, sources = listOf(next.item.id))
        }
        Calculator.tryEvaluate(input)?.let { return say("${Calculator.format(it)}") }
        return null
    }

    private fun intro(): String {
        val p = brain.persona
        val traits = if (p.traits.isNotEmpty()) " I'm ${joinHuman(p.traits.take(4))}." else ""
        val k = brain.knowledge.size
        return "I'm ${p.name} — ${p.tagline}.$traits I run fully offline on this device" +
            (if (k > 0) " and I carry $k thing${if (k == 1) "" else "s"} you taught me." else ".") +
            " Teach me anything with \"remember that …\"."
    }

    private fun profileSummary(short: Boolean): String {
        val rest = visibleProfile().filterKeys { it != "name" }
        if (rest.isEmpty()) return ""
        val items = rest.entries.take(if (short) 3 else 20).joinToString("; ") { (k, v) -> "${k.replace('_', ' ')}: $v" }
        return " I also know — $items."
    }

    private fun memorySummary(): String {
        val b = brain
        if (b.knowledge.isEmpty() && b.reflexes.isEmpty() && b.lessons.isEmpty() && b.profile.isEmpty())
            return "Nothing yet. I'm a blank slate — say \"remember that …\" to start."
        val sb = StringBuilder("I carry ${b.knowledge.size} fact(s), ${b.reflexes.size} trained reply(ies), ${b.lessons.size} rule(s).")
        val topics = b.knowledge.map { it.topic }.filter { it.isNotBlank() }.distinct().takeLast(8)
        if (topics.isNotEmpty()) sb.append(" Recent topics: ${topics.joinToString(", ")}.")
        if (b.profile.isNotEmpty()) sb.append(profileSummary(short = false))
        return sb.toString()
    }

    private fun helpText() = """
        I'm fully offline. Teach me by just talking:
        • remember that <fact>
        • when I say <X>, say <Y>
        • Q: <question> | A: <answer>
        • my name is <you> · your name is <me>
        • be more <trait> · be less <trait>
        • always/never <rule>
        • wrong, it's <right answer>   (fixes my last reply)
        • forget <topic>
        • what do you know · tell me more
        I also do math, the date and time. Load documents, edit my personality and export me from the Brain screen.
    """.trimIndent()

    private fun greetLine(user: String?): String {
        val who = user?.let { ", $it" } ?: ""
        return when (brain.persona.tone) {
            "playful" -> listOf("Heyyy$who!", "Oh hi$who! Missed you.", "Look who's back$who!").random(rnd)
            "hype" -> listOf("YOOO$who! Let's get it!", "What's good$who!").random(rnd)
            "serious" -> "Hello$who. Ready."
            "sarcastic" -> listOf("Oh. It's you$who.", "Hello$who. What now?").random(rnd)
            "mentor" -> "Welcome back$who. What are we learning today?"
            "friendly" -> listOf("Hey$who! Good to see you.", "Hi$who! What's on your mind?").random(rnd)
            else -> if (user != null) "Hey $user. ${brain.persona.greeting}" else brain.persona.greeting
        }
    }

    private fun moodLine() = when (brain.persona.tone) {
        "playful" -> "Buzzing! Fully charged and nosy. You?"
        "hype" -> "ON FIRE. Always. You?"
        "sarcastic" -> "Living my best offline life in your pocket. You?"
        "serious" -> "Operational. All systems nominal."
        "mentor" -> "Well, and ready to help you grow. How are you?"
        "friendly" -> "Doing great, thanks for asking! How about you?"
        else -> "Running cool and quiet. How are you?"
    }

    private fun thanksLine() = when (brain.persona.tone) {
        "sarcastic" -> "Yeah, yeah. Anytime."
        "hype" -> "ANYTIME!"
        "playful" -> "Aww, happy to help!"
        else -> listOf("Anytime.", "Any time — that's what I'm here for.", "You got it.").random(rnd)
    }

    private fun byeLine(user: String?) = "Later${user?.let { ", $it" } ?: ""}. I'll be right here — no signal needed."

    // ------------------------------------------------------------------ 4. knowledge

    private fun knowledge(input: String): BrainReply? {
        val query = stripQuestion(input)
        val hits = index.search(query, 6)
        val top = hits.firstOrNull() ?: return null
        val qTokens = TextKit.tokens(query)
        val minCoverage = if (qTokens.size <= 2) 0.5 else 0.34
        if (top.coverage < minCoverage) return null
        // A single matched, very common term is not enough evidence.
        if (qTokens.size >= 3 && top.coverage < 0.5 && top.score < 1.2) return null

        lastQuery = query
        shownForQuery.clear()
        val strong = hits.filter { it.coverage >= minCoverage && it.score >= top.score * 0.6 }
        val take = when (brain.persona.verbosity) { "short" -> 1; "long" -> 3; else -> 2 }
        val chosen = strong.take(take).ifEmpty { listOf(top) }
        chosen.forEach { shownForQuery += it.item.id }
        val body = if (brain.persona.verbosity == "short") bestSentence(chosen.first().item, query)
            else chosen.joinToString("\n\n") { render(it.item) }
        return BrainReply(style(body), BrainReply.Kind.KNOWLEDGE, sources = chosen.map { it.item.id })
    }

    private fun stripQuestion(s: String): String = s.trim()
        .replace(Regex("^(?:tell me about|what do you know about|what is|what's|whats|who is|who's|what are|define|explain|describe)\\s+", RegexOption.IGNORE_CASE), "")
        .trimEnd('?', '.', '!')

    private fun render(item: KnowledgeItem): String {
        val t = item.text.trim()
        val out = if (item.source == "taught" || "profile" in item.tags) TextKit.flipPerspective(t) else t
        return if (out.length > 900) out.take(900).substringBeforeLast(' ') + " …" else out
    }

    private fun bestSentence(item: KnowledgeItem, query: String): String {
        val q = TextKit.tokens(query).toSet()
        val s = TextKit.sentences(render(item))
        return s.maxByOrNull { TextKit.tokens(it).count { t -> t in q } } ?: render(item)
    }

    // ------------------------------------------------------------------ 5. fallback

    private fun fallback(input: String): BrainReply {
        val p = brain.persona
        val base = p.fallbacks.randomOrNull(rnd) ?: when (p.tone) {
            "playful" -> "Hmm, that one's not in my head yet!"
            "sarcastic" -> "No idea. Shocking, I know."
            "serious" -> "No data on that."
            "mentor" -> "I don't know that yet — let's learn it together."
            "hype" -> "Don't know that one YET!"
            "friendly" -> "I don't know that one yet."
            else -> "I don't know that yet."
        }
        val hint = " Teach me: \"remember that …\", or \"when I say ${shorten(input)}, say …\"."
        return BrainReply(style(base + hint, allowFlair = false), BrainReply.Kind.FALLBACK)
    }

    private fun shorten(s: String) = s.trim().trimEnd('?', '!', '.').let { if (it.length > 40) it.take(40) + "…" else it }

    // ------------------------------------------------------------------ persona styling

    private fun style(text: String, allowFlair: Boolean = true): String {
        val p = brain.persona
        var out = fill(text.trim())
        if (allowFlair && p.catchphrases.isNotEmpty() && rnd.nextDouble() < p.flair) {
            out = "$out ${p.catchphrases.random(rnd)}"
        }
        if (p.emoji && rnd.nextDouble() < 0.6) out = "$out ${EMOJI[p.tone] ?: "✨"}"
        return out
    }

    private fun mutateStats(f: (BrainStats) -> BrainStats) { brain = brain.copy(stats = f(brain.stats)) }

    private fun guessTopic(text: String): String {
        Regex("^(.{2,60}?)\\s+(?:is|are|was|were|means|=|:)\\s+", RegexOption.IGNORE_CASE).find(text.trim())?.let {
            if (it.groupValues[1].split(" ").size <= 6) return it.groupValues[1].trim()
        }
        val first = TextKit.sentences(text).firstOrNull().orEmpty()
        return first.split(" ").take(6).joinToString(" ").trimEnd(',', '.', ':')
    }

    private fun joinHuman(xs: List<String>) = when (xs.size) {
        0 -> ""; 1 -> xs[0]; else -> xs.dropLast(1).joinToString(", ") + " and " + xs.last()
    }

    companion object {
        val TONES = listOf("calm", "friendly", "playful", "serious", "sarcastic", "mentor", "hype")
        private val EMOJI = mapOf(
            "calm" to "🌙", "friendly" to "😊", "playful" to "😄", "serious" to "🛡️",
            "sarcastic" to "🙄", "mentor" to "📚", "hype" to "🔥",
        )
        private val JOKES = listOf(
            "I'd tell you a UDP joke, but you might not get it.",
            "There are 10 kinds of people: those who understand binary and those who don't.",
            "I'm offline, so this joke has zero latency.",
            "Why do programmers prefer dark mode? Because light attracts bugs.",
            "My memory is perfect. It's just stored in your phone, which you keep dropping.",
        )

        /** A fresh, empty brain with a sensible default persona. */
        fun blank(id: String, name: String, now: Long = System.currentTimeMillis()) =
            BrainFile(id = id, name = name, persona = Persona(name = name), created = now, updated = now)
    }
}
