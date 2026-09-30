package ai.omerta.assistant

import ai.omerta.assistant.data.brain.WebSearch
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The web-search parsers are pure — pin them so a live API shape change is caught in review. */
class WebSearchTest {
    @Test fun duckDuckGoAbstract() {
        val body = """{"Answer":"","AbstractText":"Paris is the capital of France.","AbstractURL":"https://en.wikipedia.org/wiki/Paris","RelatedTopics":[]}"""
        val r = WebSearch.parseDuckDuckGo(body)
        assertNotNull(r); assertTrue(r!!.text.contains("Paris")); assertTrue(r.source.contains("wikipedia"))
    }

    @Test fun duckDuckGoAnswerField() {
        val r = WebSearch.parseDuckDuckGo("""{"Answer":"42","AbstractText":""}""")
        assertNotNull(r); assertTrue(r!!.text == "42")
    }

    @Test fun duckDuckGoEmptyIsNull() {
        assertNull(WebSearch.parseDuckDuckGo("""{"Answer":"","AbstractText":"","RelatedTopics":[]}"""))
    }

    @Test fun wikipediaSummary() {
        val body = """{"type":"standard","extract":"The Sun is the star at the centre of the Solar System.","content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Sun"}}}"""
        val r = WebSearch.parseWikipedia(body)
        assertNotNull(r); assertTrue(r!!.text.contains("Sun")); assertTrue(r.source.contains("Sun"))
    }

    @Test fun wikipediaDisambiguationIsNull() {
        assertNull(WebSearch.parseWikipedia("""{"type":"disambiguation","extract":"May refer to..."}"""))
    }
}
