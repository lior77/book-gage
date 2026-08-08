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
}
