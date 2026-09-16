package ai.omerta.assistant.data.local

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** A durable lesson/rule the operator taught the app. */
data class Lesson(val id: Long, val type: String, val key: String, val value: String, val ts: Long)

/**
 * On-device teachable memory (SQLite). The app "learns by your commands": taught
 * RULE/LESSON/FACT items are injected into the system prompt on every turn so the
 * model applies them. Mirrors the OMERTA engine's memory model.
 */
class MemoryStore(context: Context) : SQLiteOpenHelper(context, "omerta_memory.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE lessons(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, " +
                "key TEXT NOT NULL, value TEXT NOT NULL, ts INTEGER NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {}

    fun teach(key: String, value: String, type: String = "RULE"): Long {
        val cv = ContentValues().apply {
            put("type", type); put("key", key); put("value", value); put("ts", System.currentTimeMillis())
        }
        return writableDatabase.insert("lessons", null, cv)
    }

    fun forget(id: Long): Boolean =
        writableDatabase.delete("lessons", "id=?", arrayOf(id.toString())) > 0

    fun clear() { writableDatabase.delete("lessons", null, null) }

    fun all(): List<Lesson> {
        val out = mutableListOf<Lesson>()
        readableDatabase.rawQuery(
            "SELECT id,type,key,value,ts FROM lessons ORDER BY " +
                "CASE type WHEN 'RULE' THEN 0 WHEN 'PROCEDURE' THEN 1 WHEN 'FACT' THEN 2 ELSE 3 END, id DESC",
            null,
        ).use { c ->
            while (c.moveToNext()) {
                out.add(Lesson(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getLong(4)))
            }
        }
        return out
    }

    /** Formatted block injected into the system prompt. Empty when nothing taught. */
    fun learnedContext(limit: Int = 40): String {
        val items = all().take(limit)
        if (items.isEmpty()) return ""
        val sb = StringBuilder("Operator-taught knowledge (apply unless it conflicts with safety):\n")
        for (l in items) sb.append("- [${l.type}] ${l.key}: ${l.value}\n")
        return sb.toString().trim()
    }
}
