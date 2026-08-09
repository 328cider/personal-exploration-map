plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val researchRevision = providers.environmentVariable("PDR_RESEARCH_REVISION")
    .orElse("local-docker-unpinned")
    .get()
require(Regex("[A-Za-z0-9._/-]{1,128}").matches(researchRevision)) {
    "PDR_RESEARCH_REVISION must be a safe revision identifier"
}

android {
    namespace = "com.personalexplorationmap.pdrcapture"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.personalexplorationmap.pdrcapture"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-research"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "RESEARCH_SCHEMA_VERSION", "\"pdr-capture/v1\"")
        buildConfigField("String", "RESEARCH_REVISION", "\"$researchRevision\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
