import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Push notifications are optional: apply Google Services only when google-services.json is present.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

fun prop(name: String, default: String = ""): String = (project.findProperty(name) as String?) ?: default

val apiUrl = prop("campuscare.apiUrl", "http://10.0.2.2:4000").trimEnd('/')
val webUrl = prop("campuscare.webUrl", "http://10.0.2.2:3000").trimEnd('/')
val webHost = webUrl.substringAfter("://").substringBefore("/").substringBefore(":")

// Release signing comes from keystore.properties (never committed). See README.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "edu.srmap.campuscare"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.edu.srmap.campuscare"
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("campuscare.versionCode") as String?)?.toInt() ?: 1
        versionName = prop("campuscare.versionName", "1.0.0")

        buildConfigField("String", "API_BASE_URL", "\"$apiUrl\"")
        buildConfigField("String", "WEB_BASE_URL", "\"$webUrl\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"${prop("campuscare.googleWebClientId")}\"")
        buildConfigField("String", "ACCOUNT_EMAIL_DOMAIN", "\"srmap.edu.in\"")
        // Map tiles: empty = the OpenStreetMap standard tiles (fine for low volume with attribution, per the
        // OSM tile usage policy). Production should point this at a tile host it is licensed to use,
        // e.g. -Pcampuscare.mapTileUrl=https://tiles.example.edu/{z}/{x}/{y}.png
        buildConfigField("String", "MAP_TILE_URL", "\"${prop("campuscare.mapTileUrl")}\"")
        buildConfigField("String", "MAP_ATTRIBUTION", "\"${prop("campuscare.mapAttribution", "© OpenStreetMap contributors")}\"")
        manifestPlaceholders["webHost"] = webHost
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            versionNameSuffix = "-debug"
            resValue("string", "app_name", "CampusCare (debug)")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            resValue("string", "app_name", "CampusCare")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            if (!apiUrl.startsWith("https://")) {
                logger.warn("CampusCare: release build uses a non-HTTPS API URL ($apiUrl). Set -Pcampuscare.apiUrl=https://…")
            }
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.animation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.osmdroid)
    implementation(libs.play.services.location)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.googleid)
    implementation(libs.socket.io.client) {
        exclude(group = "org.json", module = "json")
    }
    implementation(libs.coil.compose)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    debugImplementation(libs.androidx.compose.ui.tooling)
    testImplementation(libs.junit)
}
