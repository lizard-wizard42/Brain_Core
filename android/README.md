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

The debug package has the `.dev` suffix and can be installed beside the signed release. Build outputs, local SDK settings, signing properties, and the signing key stay outside Git. To produce the signed release, provide your signing properties file (path in `BRAINCORE_ANDROID_SIGNING_PROPS`, default `~/.config/braincore/android-signing.properties`) and run `./gradlew :app:assembleRelease`; then verify it with `apksigner verify --print-certs`.

## Recording reliability in Android 1.1.2

Update the server and install the signed 1.1.2 APK over the existing release; do not uninstall or clear app storage when recordings are pending. The updated app sends the recorded end time, so an offline recording uploaded the next day keeps its real duration. Older completed sessions are not rewritten.

Signing out of the web app preserves valid Android device links. Password/security changes and explicitly unlinking a device still revoke access. If an earlier server version already invalidated a link, sign in to the same account in **PC** and link recordings again in **Ajustes**. Pending audio remains assigned to its original account. Check the upload and transcription settings and keep the computer available until processing finishes.

Web history, search links and the dashboard now follow the browser timezone instead of UTC calendar dates.

## Android 1.1.3 startup

Database recovery and background-work scheduling now run off the main thread so they do not hold up the first screen. The web view shows loading feedback and avoids pushing a duplicate initial route into browser history. Recording recovery and account-scoped upload behavior are retained.

Update using an APK with the same package and signing certificate as the installed app. A `.dev` installation may contain real recordings: never uninstall it or clear its storage to install an update, and do not run database instrumentation against a personal installation.

## Android 1.1.4 native notifications

Linked devices synchronize reminder metadata from their own account, independently of audio upload preferences. Android schedules downloaded reminders locally, including daily repeats, and restores future schedules after restart, app update, and clock/timezone changes. Date-only reminders use 09:00 in the phone timezone. No note body or title is stored for background notifications; the alert opens Notes. Completed mobile transcriptions open the Timeline.

Open Settings → This device to test an alert or manage Android notification channels and sounds. Android 13+ requires notification permission. The white Brain Core vector is used in the status bar and for themed launcher icons.

This is local scheduling plus background synchronization, not Firebase push. Changes made on another device are fetched when opening the app and periodically (minimum 15 minutes, possibly delayed by Android). The computer and private network must be reachable to fetch changes. Downloaded alarms work offline; edits/deletions made elsewhere take effect after the next successful sync. Alarms are inexact and may be delayed by battery saving; this is not an exact-time alarm clock. Force-stopping the app disables background delivery until it is opened again. Unlinking or switching accounts cancels downloaded reminders.

## Voice identification in Android 1.1.5

Update both the server and the app. The native timeline now preserves the server's voice groups and owner-match indication instead of displaying every unconfirmed group as unidentified. It refreshes completed transcripts when opened; **Atualizar vozes** retries without recording or transcribing again. Cached identification remains available offline, and correction controls open on demand.

The server compares each voice group with the account's enrolled sample and its active, manually confirmed voice references. Several groups may match the same owner; groups no longer compete against each other for a single owner slot. References for other participants can block an ambiguous match. A group with six seconds of speech can be displayed even when ASR produced fewer than three sentences.

**Eu (provável)** is an automatic suggestion, not a confirmed identity or a calibrated probability. Manual corrections take priority, and deleted/revoked references stop contributing. Short, noisy or mixed-speaker audio can still remain unidentified. Naming a whole voice in the web conversation applies to that session; correcting a suitable individual segment can supply a reusable reference. No accuracy percentage is claimed from synthetic tests.
