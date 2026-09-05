package com.hebsub.core.provider.claude

/**
 * Anthropic Messages API constants. The HTTP call itself lives in the app layer;
 * this module only builds the request body and parses the response so the logic
 * stays unit-testable without a network.
 */
object ClaudeApi {
    const val ENDPOINT = "https://api.anthropic.com/v1/messages"
    const val VERSION = "2023-06-01"
    const val HEADER_API_KEY = "x-api-key"
    const val HEADER_VERSION = "anthropic-version"

    /** Default model — good Hebrew quality at high-volume-friendly cost. User-configurable. */
    const val DEFAULT_MODEL = "claude-sonnet-5"

    /** Models offered in Settings, most capable first. */
    val AVAILABLE_MODELS = listOf(
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5",
    )

    /**
     * Whether this model accepts `output_config.effort`.
     *
     * It is how much thinking the model does before it answers, and it matters
     * here because thinking tokens come out of the SAME `max_tokens` budget as the
     * answer. Left unset, Opus 5 and Sonnet 5 both think adaptively at effort
     * `high` — which is right for a hard problem and wrong for translating forty
     * subtitle lines, where the thinking can eat the budget the Hebrew needed.
     *
     * Haiku 4.5 predates the parameter and rejects it with a 400, so it is only
     * sent to models that understand it.
     */
    fun supportsEffort(model: String): Boolean = !model.startsWith("claude-haiku-4-5")

    /** Largest output budget worth asking of [model], thinking included. */
    fun maxOutputTokens(model: String): Int = if (supportsEffort(model)) 16_000 else 8_192
}
