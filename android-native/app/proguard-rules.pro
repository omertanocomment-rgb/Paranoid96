# Entry points referenced from the manifest — keep them or R8 strips them.
-keep class com.omerta.agent.MainActivity { *; }
-keep class com.omerta.agent.BackendService { *; }
-keep class com.omerta.agent.BackendLauncher { *; }
-keep class com.omerta.agent.OmertaPython { *; }
-keep class com.omerta.agent.OmertaAssets { *; }

-keepclassmembers class * extends android.app.Activity {
    public void *(android.view.View);
}
# WebView JS bridge surface (none currently, but keep the contract explicit)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn android.webkit.**

# Chaquopy runtime + native bridge
-keep class com.chaquo.python.** { *; }
-dontwarn com.chaquo.python.**
