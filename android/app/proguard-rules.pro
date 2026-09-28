# Keep kotlinx.serialization generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class ai.omerta.assistant.data.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class ai.omerta.assistant.data.model.**$$serializer { *; }
-keep class ai.omerta.assistant.data.model.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Offline brain file format (kotlinx.serialization)
-keep class ai.omerta.assistant.data.brain.** { *; }
-keepclassmembers class ai.omerta.assistant.data.brain.** { *** Companion; }

# MediaPipe LLM inference (JNI + protobuf lite + AutoValue)
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.mediapipe.**
-dontwarn com.google.protobuf.**
-dontwarn com.google.auto.value.**
-dontwarn javax.lang.model.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn org.checkerframework.**
