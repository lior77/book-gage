# Keep kotlinx.serialization generated serializers.
-keepclassmembers class ** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.** { *; }
-keep,includedescriptorclasses class com.hebsub.**$$serializer { *; }

# OkHttp / Okio (platform reflection warnings).
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**

# FFmpegKit native bridge.
-keep class com.arthenica.ffmpegkit.** { *; }
-dontwarn com.arthenica.ffmpegkit.**
