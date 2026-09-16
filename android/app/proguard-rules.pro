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
