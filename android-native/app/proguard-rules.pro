# The Activity is referenced from the manifest only — keep it and its
# lifecycle callbacks, or R8 will strip the entry point.
-keep class com.omerta.agent.MainActivity { *; }
-keep class com.omerta.agent.BackendLauncher { *; }
-keepclassmembers class * extends android.app.Activity {
    public void *(android.view.View);
}
# WebView JS bridge surface (none currently, but keep the contract explicit)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn android.webkit.**
