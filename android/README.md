# Brain Core for Android

Download the signed APK from the [latest Brain Core release](https://github.com/lizard-wizard42/Brain_Core/releases/latest/download/brain-core-android.apk). Compare its SHA-256 with the value in the release notes before installing. The app requires Android 7.0 (API 24) or newer.

The Android companion has a local timeline and a microphone recorder. Recording starts only when you tap **Gravar**. It stores completed `.m4a` chunks in the app's private storage and queues uploads when the network is unavailable. The app marks a chunk uploaded only after the server confirms its SHA-256. The local queue remains available across app restarts. Browser pages, attachments, and the canvas open in the **PC** tab from your own Brain Core server.

To connect, configure an HTTPS origin in **Ajustes**, sign in through the **PC** tab, and choose **Vincular gravações**. A linked device receives an account-scoped credential protected by Android Keystore; it does not receive the memory service token. Pending recordings stay assigned to the account that created them. Use [the Android and Tailscale guide](../docs/ANDROID.md) for a self-hosted setup.

Transcription and speaker review require the optional memory service. The standard Docker installation starts with that integration offline, so recording on the phone does not by itself enable server transcription. Obtain consent before recording other people.

## Build from source

Open this directory in Android Studio, or run:

```bash
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

The debug package has the `.dev` suffix and can be installed beside the signed release. Build outputs, local SDK settings, signing properties, and the signing key stay outside Git. See `scripts/build-release.sh` for the signed release build and verification flow.
