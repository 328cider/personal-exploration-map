FROM gradle:8.9.0-jdk21 AS gradle-runtime

FROM ghcr.io/cirruslabs/android-sdk:35@sha256:c724009e305b4607157287624033ab97f319af44c244bfc9f73b6293f3bb01b9

COPY --from=gradle-runtime /opt/gradle /opt/gradle
ENV PATH="/opt/gradle/bin:${PATH}" \
    GRADLE_USER_HOME=/gradle-cache

WORKDIR /workspace/research/pdr/android-capture

CMD ["gradle", "--no-daemon", "testDebugUnitTest", "lintDebug", "assembleDebug", "assembleDebugAndroidTest"]
