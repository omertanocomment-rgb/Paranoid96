package ai.omerta.assistant

import ai.omerta.assistant.data.brain.BrainEngine
import ai.omerta.assistant.data.brain.BrainFile
import ai.omerta.assistant.data.brain.BrainReply.Kind
import ai.omerta.assistant.data.brain.Calculator
import ai.omerta.assistant.data.brain.Persona
import ai.omerta.assistant.data.brain.PromptFormat
import ai.omerta.assistant.data.brain.TextKit
import ai.omerta.assistant.data.model.WireMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneId
import kotlin.random.Random

class BrainEngineTest {

    private val t0 = 1_760_000_000_000L // fixed clock

    private fun engine(persona: Persona = Persona(name = "Nova", catchphrases = emptyList(), flair = 0.0)) =
        BrainEngine(BrainFile(id = "t", name = "Test", persona = persona), { t0 }, ZoneId.of("UTC"), Random(7))

    @Test fun remembersAndRecallsFacts() {
        val e = engine()
        assertEquals(Kind.TAUGHT, e.respond("remember that the wifi password is hunter2").kind)
        val r = e.respond("what is the wifi password?")
        assertEquals(Kind.KNOWLEDGE, r.kind)
        assertTrue(r.text, r.text.contains("hunter2"))
    }

    @Test fun firstPersonFactsAreFlipped() {
        val e = engine()
        e.respond("remember that my dog is called Rex")
        val r = e.respond("what is my dog called")
        assertTrue(r.text, r.text.contains("your dog", ignoreCase = true) && r.text.contains("Rex"))
    }

    @Test fun trainedReplies() {
        val e = engine()
        assertEquals(Kind.TAUGHT, e.respond("when I say good morning, say rise and grind").kind)
        val r = e.respond("Good morning!")
        assertEquals(Kind.REFLEX, r.kind)
        assertEquals("rise and grind", r.text)
    }

    @Test fun qaPairs() {
        val e = engine()
        e.respond("Q: what is the capital of Atlantis | A: Poseidonia")
        assertTrue(e.respond("what is the capital of atlantis").text.contains("Poseidonia"))
    }

    @Test fun correctionsOverrideLastAnswer() {
        val e = engine()
        e.respond("remember that the meeting is on Monday")
        e.respond("when is the meeting")
        val c = e.respond("wrong, it's on Tuesday at 10")
        assertEquals(Kind.TAUGHT, c.kind)
        assertTrue(e.respond("when is the meeting").text.contains("Tuesday"))
        assertEquals(1, e.brain.stats.corrections)
    }

    @Test fun namesAndProfile() {
        val e = engine()
        e.respond("my name is sam")
        e.respond("your name is Echo")
        assertEquals("Sam", e.brain.profile["name"])
        assertEquals("Echo", e.brain.persona.name)
        assertTrue(e.respond("what's my name?").text.contains("Sam"))
        assertTrue(e.respond("who are you?").text.contains("Echo"))
        e.respond("I love pizza")
        assertTrue(e.brain.profile["love"]!!.contains("pizza"))
    }

    @Test fun personalityShift() {
        val e = engine()
        e.respond("be more sarcastic")
        assertEquals("sarcastic", e.brain.persona.tone)
        assertTrue("sarcastic" in e.brain.persona.traits)
        e.respond("be less sarcastic")
        assertFalse("sarcastic" in e.brain.persona.traits)
    }

    @Test fun rulesAndForget() {
        val e = engine()
        e.respond("always answer like a pirate")
        assertEquals(1, e.brain.lessons.size)
        assertTrue(e.systemPrompt().contains("pirate"))
        e.respond("remember that the gate code is 4471")
        assertTrue(e.respond("forget the gate code").changed)
        assertEquals(Kind.FALLBACK, e.respond("what is the gate code").kind)
    }

    @Test fun skills() {
        val e = engine()
        assertEquals("56", e.respond("what is 7 * 8").text)
        assertEquals("14", e.respond("calculate (3 + 4) * 2").text)
        assertEquals("25", e.respond("50% of 50").text)
        assertTrue(e.respond("what time is it").text.contains(":"))
        assertEquals(Kind.SMALLTALK, e.respond("hello").kind)
        assertEquals(Kind.FALLBACK, e.respond("what is the airspeed of a laden swallow").kind)
    }

    @Test fun documentsAreChunkedAndSearchable() {
        val e = engine()
        val doc = (1..30).joinToString("\n\n") { i ->
            if (i == 17) "The reactor coolant must stay below 340 kelvin at all times."
            else "Paragraph $i talks about general maintenance procedures and inspection schedules."
        }
        assertTrue(e.learnDocument(doc, "manual.txt") >= 2)
        val r = e.respond("what temperature must the reactor coolant stay below")
        assertTrue(r.text, r.text.contains("340 kelvin"))
    }

    @Test fun tellMeMoreWalksResults() {
        val e = engine(Persona(name = "N", verbosity = "short", flair = 0.0))
        e.addFact("Rust is a systems language.", topic = "rust")
        e.addFact("Rust has a borrow checker.", topic = "rust")
        val first = e.respond("tell me about rust")
        assertEquals(Kind.KNOWLEDGE, first.kind)
        val more = e.respond("tell me more")
        assertEquals(Kind.KNOWLEDGE, more.kind)
        assertTrue(first.text != more.text)
    }

    @Test fun brainFileRoundTrip() {
        val e = engine()
        e.respond("remember that tea is better than coffee")
        e.respond("when I say ping, say pong")
        val text = e.brain.encode()
        val back = BrainFile.parse(text)
        assertEquals(e.brain.knowledge, back.knowledge)
        assertEquals(e.brain.reflexes, back.reflexes)
        assertEquals("omerta-brain/1", back.format)
    }

    @Test fun starterPackAnswersBasicQuestions() {
        val f = listOf("src/main/assets/brains/omerta.brain", "app/src/main/assets/brains/omerta.brain")
            .map(::File).first { it.exists() }
        val b = BrainFile.parse(f.readText())
        val e = BrainEngine(b, { t0 }, ZoneId.of("UTC"), Random(1))
        assertTrue(e.respond("what is the capital of France").text.contains("Paris"))
        assertTrue(e.respond("how many days in a year").text.contains("365"))
    }

    @Test fun bundledDefaultBrainParses() {
        val f = listOf("src/main/assets/brains/omerta.brain", "app/src/main/assets/brains/omerta.brain")
            .map(::File).first { it.exists() }
        val b = BrainFile.parse(f.readText())
        assertTrue(b.knowledge.isNotEmpty())
        val e = BrainEngine(b, { t0 }, ZoneId.of("UTC"), Random(1))
        assertEquals(Kind.SKILL, e.respond("how do I teach you").kind)
        val r = e.respond("what is a brain file?")
        assertEquals(Kind.KNOWLEDGE, r.kind)
        assertTrue(r.text, r.text.contains(".brain"))
        assertEquals(Kind.REFLEX, e.respond("good morning").kind)
        assertTrue(e.respond("how do I use adb wireless").text.contains("adb pair"))
    }

    @Test fun casualChatIsNotMistakenForTeaching() {
        val e = engine()
        assertFalse(e.respond("never mind").kind == Kind.TAUGHT)
        assertFalse(e.respond("remember when we met?").kind == Kind.TAUGHT)
        assertFalse(e.respond("be careful with that").kind == Kind.TAUGHT)
        assertEquals(0, e.brain.lessons.size)
        assertEquals(0, e.brain.knowledge.size)
        e.respond("from now on answer in one sentence")
        assertEquals(1, e.brain.lessons.size)
        assertTrue(e.brain.persona.traits.none { it.contains("answer") })
    }

    @Test fun adaptivePersonaMirrorsStyle() {
        val e = engine(Persona(name = "N", tone = "calm", verbosity = "medium", emoji = false, flair = 0.0))
        // Short, excited, emoji-heavy messages → playful, short, emoji on.
        repeat(8) { e.observeUser("yay!! love it 😄🔥") }
        assertEquals("playful", e.brain.persona.tone)
        assertEquals("short", e.brain.persona.verbosity)
        assertTrue(e.brain.persona.emoji)
        // Hidden counters are tracked but never leak into what the brain says.
        assertTrue(e.brain.profile.keys.any { it.startsWith("_") })
        e.respond("my name is Sam")
        assertFalse(e.respond("what do you know").text.contains("_style"))
        assertFalse(e.respond("what's my name?").text.contains("_style"))
    }

    @Test fun teachingDeduplicates() {
        val e = engine()
        e.addFact("The wifi password is bluefish42")
        val before = e.brain.knowledge.size
        e.addFact("the wifi password is bluefish42.")   // same fact, trivial variation
        assertEquals(before, e.brain.knowledge.size)      // merged, not piled up
        assertTrue(e.respond("what is the wifi password").text.contains("bluefish42"))
    }

    @Test fun personaAccentRoundTrips() {
        val e = engine()
        e.updatePersona(e.brain.persona.copy(accent = "#00E5FF"))
        val back = BrainFile.parse(e.brain.encode())
        assertEquals("#00E5FF", back.persona.accent)
    }

    @Test fun perspectiveFlip() {
        assertEquals("your cat is called Tom", TextKit.flipPerspective("my cat is called Tom"))
        assertEquals("You are from Leeds.", TextKit.flipPerspective("I am from Leeds."))
    }

    @Test fun calculatorRejectsPlainText() {
        assertEquals(null, Calculator.tryEvaluate("what is love"))
        assertEquals(null, Calculator.tryEvaluate("2024"))
        assertEquals(1024.0, Calculator.tryEvaluate("2^10")!!, 0.0)
    }

    @Test fun promptFormats() {
        val h = listOf(WireMessage("user", "hi"))
        val g = PromptFormat.build("gemma", "SYS", h)
        assertTrue(g.startsWith("<start_of_turn>user\nSYS\n\nhi<end_of_turn>"))
        assertTrue(g.endsWith("<start_of_turn>model\n"))
        assertTrue(PromptFormat.build("chatml", "SYS", h).endsWith("<|im_start|>assistant\n"))
    }
}
