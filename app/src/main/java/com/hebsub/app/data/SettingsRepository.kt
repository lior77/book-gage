package com.hebsub.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.hebsub.core.provider.claude.ClaudeApi
import org.json.JSONObject

/**
 * All user configuration, including API keys. Keys are stored **encrypted at
 * rest** via Android Keystore-backed [EncryptedSharedPreferences]; they are
 * entered once by the user, never bundled in the app, never logged, and never
 * sent anywhere except the corresponding provider's own HTTPS endpoint.
 */
class SettingsRepository(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "hebsub_secure_settings",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var onboardingComplete: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDED, false)
        set(v) = prefs.edit().putBoolean(KEY_ONBOARDED, v).apply()

    var onlineSearchEnabled: Boolean
        get() = prefs.getBoolean(KEY_ONLINE, true)
        set(v) = prefs.edit().putBoolean(KEY_ONLINE, v).apply()

    var openSubtitlesApiKey: String
        get() = prefs.getString(KEY_OS_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_OS_KEY, v.trim()).apply()

    var anthropicApiKey: String
        get() = prefs.getString(KEY_ANTHROPIC_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_ANTHROPIC_KEY, v.trim()).apply()

    var deepgramApiKey: String
        get() = prefs.getString(KEY_DEEPGRAM_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_DEEPGRAM_KEY, v.trim()).apply()

    var omdbApiKey: String
        get() = prefs.getString(KEY_OMDB_KEY, "").orEmpty()
        set(v) = prefs.edit().putString(KEY_OMDB_KEY, v.trim()).apply()

    var claudeModel: String
        get() = prefs.getString(KEY_MODEL, ClaudeApi.DEFAULT_MODEL) ?: ClaudeApi.DEFAULT_MODEL
        set(v) = prefs.edit().putString(KEY_MODEL, v).apply()

    val hasAnthropicKey: Boolean get() = anthropicApiKey.isNotBlank()
    val hasOpenSubtitlesKey: Boolean get() = openSubtitlesApiKey.isNotBlank()
    val hasDeepgramKey: Boolean get() = deepgramApiKey.isNotBlank()
    val hasOmdbKey: Boolean get() = omdbApiKey.isNotBlank()

    /**
     * Serialize the keys + model + online flag to a JSON backup the user can save
     * to a file and re-import after a reinstall (encrypted storage is wiped when
     * the app is uninstalled). The file holds the keys in plain text, so it must
     * be kept private — it never leaves the device on its own.
     */
    fun exportKeysJson(): String = JSONObject().apply {
        put(F_VERSION, 1)
        put(F_OS, openSubtitlesApiKey)
        put(F_ANTHROPIC, anthropicApiKey)
        put(F_DEEPGRAM, deepgramApiKey)
        put(F_OMDB, omdbApiKey)
        put(F_MODEL, claudeModel)
        put(F_ONLINE, onlineSearchEnabled)
    }.toString(2)

    /**
     * Import keys from a JSON backup produced by [exportKeysJson]. Only non-blank
     * values overwrite existing settings, so a partial file never clears a key
     * that isn't in it. Returns how many API keys were applied.
     */
    fun importKeysJson(json: String): Int {
        val o = JSONObject(json)
        var applied = 0
        fun apply(field: String, set: (String) -> Unit) {
            val v = o.optString(field, "").trim()
            if (v.isNotEmpty()) { set(v); applied++ }
        }
        apply(F_OS) { openSubtitlesApiKey = it }
        apply(F_ANTHROPIC) { anthropicApiKey = it }
        apply(F_DEEPGRAM) { deepgramApiKey = it }
        apply(F_OMDB) { omdbApiKey = it }
        o.optString(F_MODEL, "").trim().takeIf { it.isNotEmpty() }?.let { claudeModel = it }
        if (o.has(F_ONLINE)) onlineSearchEnabled = o.optBoolean(F_ONLINE, onlineSearchEnabled)
        return applied
    }

    private companion object {
        const val KEY_ONBOARDED = "onboarded"
        const val KEY_ONLINE = "online_search"
        const val KEY_OS_KEY = "opensubtitles_key"
        const val KEY_ANTHROPIC_KEY = "anthropic_key"
        const val KEY_DEEPGRAM_KEY = "deepgram_key"
        const val KEY_OMDB_KEY = "omdb_key"
        const val KEY_MODEL = "claude_model"

        // JSON field names for the keys backup file.
        const val F_VERSION = "hebsub_keys_version"
        const val F_OS = "opensubtitles"
        const val F_ANTHROPIC = "anthropic"
        const val F_DEEPGRAM = "deepgram"
        const val F_OMDB = "omdb"
        const val F_MODEL = "model"
        const val F_ONLINE = "online_search"
    }
}
