package ai.omerta.assistant.data.brain

import kotlin.math.pow
import kotlin.math.sqrt

/** Tiny safe arithmetic evaluator (+ - * / % ^, parentheses, sqrt) for offline math. */
object Calculator {

    private val wordOps = listOf(
        "multiplied by" to "*", "divided by" to "/", "to the power of" to "^", "percent of" to "%of",
        "plus" to "+", "minus" to "-", "times" to "*", "over" to "/", "mod" to "%", "x" to "*",
        "squared" to "^2", "cubed" to "^3", "square root of" to "sqrt",
    )

    /** Extracts and evaluates an arithmetic expression from free text, or null. */
    fun tryEvaluate(text: String): Double? {
        var s = " " + text.lowercase()
            .replace(Regex("^(what'?s|what is|calculate|compute|solve|how much is|eval)\\s+"), "")
            .replace("?", "").replace("=", "") + " "
        for ((w, op) in wordOps) s = s.replace(Regex("(?<=[\\s\\d)])${Regex.escape(w)}(?=[\\s\\d(])"), " $op ")
        s = s.trim()
        // X% of Y
        Regex("^([\\d.]+)\\s*(?:%|%of)\\s*(?:of)?\\s*([\\d.]+)$").find(s)?.let {
            return it.groupValues[1].toDouble() / 100.0 * it.groupValues[2].toDouble()
        }
        if (!Regex("^[\\d\\s+\\-*/%^().sqrt]+$").matches(s)) return null
        if (!s.any { it.isDigit() } || s.none { it in "+-*/%^" || s.contains("sqrt") }) return null
        return runCatching { Parser(s.replace(" ", "")).parse() }.getOrNull()?.takeIf { !it.isNaN() && !it.isInfinite() }
    }

    fun format(d: Double): String =
        if (d == Math.floor(d) && kotlin.math.abs(d) < 1e15) d.toLong().toString()
        else "%.6f".format(java.util.Locale.US, d).trimEnd('0').trimEnd('.')

    private class Parser(val s: String) {
        var i = 0
        fun parse(): Double { val v = expr(); require(i == s.length) { "trailing input" }; return v }
        fun expr(): Double {
            var v = term()
            while (i < s.length && (s[i] == '+' || s[i] == '-')) { val op = s[i++]; val r = term(); v = if (op == '+') v + r else v - r }
            return v
        }
        fun term(): Double {
            var v = factor()
            while (i < s.length && (s[i] == '*' || s[i] == '/' || s[i] == '%')) {
                val op = s[i++]; val r = factor()
                v = when (op) { '*' -> v * r; '/' -> v / r; else -> v % r }
            }
            return v
        }
        fun factor(): Double {
            val base = unary()
            if (i < s.length && s[i] == '^') { i++; return base.pow(factor()) }
            return base
        }
        fun unary(): Double {
            if (i < s.length && s[i] == '-') { i++; return -unary() }
            if (i < s.length && s[i] == '+') { i++; return unary() }
            if (s.startsWith("sqrt", i)) { i += 4; return sqrt(unary()) }
            if (i < s.length && s[i] == '(') { i++; val v = expr(); require(s[i++] == ')'); return v }
            val start = i
            while (i < s.length && (s[i].isDigit() || s[i] == '.')) i++
            require(i > start) { "number expected" }
            return s.substring(start, i).toDouble()
        }
    }
}
