# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class edu.srmap.campuscare.**$$serializer { *; }
-keepclassmembers class edu.srmap.campuscare.** { *** Companion; }
-keepclasseswithmembers class edu.srmap.campuscare.** { kotlinx.serialization.KSerializer serializer(...); }

# Socket.IO / Engine.IO
-keep class io.socket.** { *; }
-dontwarn io.socket.**
-dontwarn okhttp3.**
-dontwarn okio.**

# WebView JavaScript bridge for Cloudflare Turnstile
-keepclassmembers class edu.srmap.campuscare.ui.components.TurnstileBridge { @android.webkit.JavascriptInterface <methods>; }

# osmdroid
-dontwarn org.osmdroid.**

# Credential Manager
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
