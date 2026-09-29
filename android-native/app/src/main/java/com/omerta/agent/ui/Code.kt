package com.omerta.agent.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle

/**
 * Colour for code, without changing a character of it.
 *
 * This is a VisualTransformation with an IDENTITY offset mapping, which is the
 * only safe shape for an editor: the moment a transformation inserts or
 * removes characters, every cursor position and selection has to be mapped
 * back and forth, and getting that subtly wrong corrupts the file the user is
 * editing rather than merely looking wrong.
 *
 * It is a lexer in the loosest sense — one pass, longest-match-first, no
 * parser and no state carried across lines beyond a block comment. It has to
 * be fast enough to run on every keystroke on a phone, and it has to cope with
 * a half-typed line, because that is what a file being edited always is.
 */
object Code {

    private val KEYWORDS = mapOf(
        "py" to setOf(
            "def", "class", "return", "if", "elif", "else", "for", "while",
            "try", "except", "finally", "with", "as", "import", "from", "in",
            "is", "not", "and", "or", "None", "True", "False", "lambda",
            "yield", "raise", "pass", "break", "continue", "global", "await",
            "async", "assert", "del", "nonlocal"),
        "kt" to setOf(
            "fun", "val", "var", "class", "object", "interface", "return", "if",
            "else", "when", "for", "while", "try", "catch", "finally", "import",
            "package", "private", "internal", "public", "override", "suspend",
            "data", "sealed", "companion", "init", "by", "in", "is", "as",
            "null", "true", "false", "this", "super", "const", "lateinit"),
        "java" to setOf(
            "public", "private", "protected", "class", "interface", "extends",
            "implements", "return", "if", "else", "for", "while", "switch",
            "case", "try", "catch", "finally", "import", "package", "new",
            "static", "final", "void", "int", "long", "boolean", "null",
            "true", "false", "this", "super", "throw", "throws"),
        "sh" to setOf(
            "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
            "case", "esac", "function", "return", "export", "local", "set",
            "echo", "cd", "exit", "source"),
        "js" to setOf(
            "function", "const", "let", "var", "return", "if", "else", "for",
            "while", "class", "extends", "import", "export", "from", "new",
            "async", "await", "try", "catch", "finally", "null", "undefined",
            "true", "false", "this", "typeof"),
    )

    private val LINE_COMMENT = mapOf(
        "py" to "#", "sh" to "#", "kt" to "//", "java" to "//", "js" to "//",
        "json" to "//", "md" to "", "txt" to "",
    )

    /** The language of a path, by extension. Unknown means "no keywords". */
    fun langOf(path: String): String = when (path.substringAfterLast('.', "")) {
        "py", "pyi" -> "py"
        "kt", "kts" -> "kt"
        "java" -> "java"
        "sh", "bash", "zsh" -> "sh"
        "js", "ts", "tsx", "jsx" -> "js"
        "json" -> "json"
        "md", "markdown" -> "md"
        else -> "txt"
    }

    private fun isWordChar(c: Char) = c.isLetterOrDigit() || c == '_'

    fun highlight(text: String, lang: String): AnnotatedString {
        val words = KEYWORDS[lang] ?: emptySet()
        val comment = LINE_COMMENT[lang] ?: ""
        return buildAnnotated(text, words, comment)
    }

    private fun buildAnnotated(
        text: String, words: Set<String>, comment: String,
    ) = androidx.compose.ui.text.buildAnnotatedString {
        var i = 0
        val n = text.length
        while (i < n) {
            val c = text[i]

            // a comment runs to the end of the line, whatever is in it
            if (comment.isNotEmpty() && text.startsWith(comment, i)) {
                val end = text.indexOf('\n', i).let { if (it < 0) n else it }
                withStyle(SpanStyle(color = TextLo)) { append(text, i, end) }
                i = end
                continue
            }

            // a string runs to its closing quote, or to the end of the line:
            // an unterminated quote is what a line being typed looks like,
            // and it must not swallow the rest of the file.
            if (c == '"' || c == '\'' || c == '`') {
                var j = i + 1
                while (j < n && text[j] != c && text[j] != '\n') {
                    if (text[j] == '\\') j++
                    j++
                }
                val end = (if (j < n && text[j] == c) j + 1 else j).coerceAtMost(n)
                withStyle(SpanStyle(color = Good)) { append(text, i, end) }
                i = end
                continue
            }

            if (c.isDigit() && (i == 0 || !isWordChar(text[i - 1]))) {
                var j = i
                while (j < n && (text[j].isLetterOrDigit() || text[j] == '.')) j++
                withStyle(SpanStyle(color = Amber)) { append(text, i, j) }
                i = j
                continue
            }

            if (isWordChar(c)) {
                var j = i
                while (j < n && isWordChar(text[j])) j++
                val word = text.substring(i, j)
                if (word in words) {
                    withStyle(SpanStyle(color = Ember)) { append(word) }
                } else {
                    append(word)
                }
                i = j
                continue
            }

            append(c)
            i++
        }
    }
}

/** The transformation the editor hands to BasicTextField. */
class CodeTransformation(private val lang: String) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText =
        TransformedText(Code.highlight(text.text, lang), OffsetMapping.Identity)
}
