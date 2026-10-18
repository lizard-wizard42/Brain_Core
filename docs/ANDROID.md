# Android companion over Tailscale

The [signed Android APK](https://github.com/lizard-wizard42/Brain_Core/releases/latest/download/brain-core-android.apk) connects to a Brain Core server that you control. The app needs an HTTPS address for its **PC** tab and for account linking. Tailscale Serve provides that address only to devices in your tailnet; use Serve, not Funnel. The app can keep already-linked recordings in its local queue while offline.

## 1. Start Brain Core on the computer

Follow the [Docker quick start](../README.md#quick-start) and confirm that `http://127.0.0.1:8080` opens on the computer. Docker's standard setup keeps the database and backend private and binds only the web entrypoint to loopback.

## 2. Give the computer a private HTTPS address

Install Tailscale on the computer and Android phone, sign in to the same tailnet, and enable HTTPS certificates for the tailnet when prompted. On the computer, run:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve status
```

Open the resulting `https://<computer>.<tailnet>.ts.net` address in the phone's browser. Replace the example below with your own address only in your local, untracked `.env.docker`:

```bash
test -e .env.docker || cp .env.docker.example .env.docker
```

```dotenv
CORS_ORIGIN=https://computer.example-tailnet.ts.net
AUTH_COOKIE_SECURE=true
```

Recreate the Compose services with `docker compose --env-file .env.docker up --build -d` after changing this configuration. Use the Tailscale HTTPS address for browser login while secure cookies are enabled. The mobile device-link endpoint accepts only an origin explicitly configured in `CORS_ORIGIN`; do not use a wildcard. Do not put your real tailnet name, credentials, or server secrets in Git. You can use [Tailscale grants](https://tailscale.com/docs/features/access-control/grants) to limit which devices reach this computer's port 443.

## 3. Install and link the app

Download `brain-core-android.apk` from the [latest release](https://github.com/lizard-wizard42/Brain_Core/releases/latest/download/brain-core-android.apk) and compare its SHA-256 with the release notes. In the Android app, open **Ajustes**, enter the exact HTTPS origin from Tailscale Serve, and save it. In **PC**, sign in to your Brain Core account. Return to **Ajustes** and select **Vincular gravações**. The app stores the resulting device credential in Android protected storage, not in the APK.

To record, open **Linha do tempo**, tap **Gravar**, grant microphone and notification permissions, and tap **Parar** when finished. The app saves completed audio chunks locally and retries upload after connectivity returns. A recording remains attached to the account it was created for. Unlink the device before changing accounts or servers.

## Transcription and privacy

The standard Docker installation starts with the memory integration **offline**. Phone recording and local playback do not require a transcription server; upload, server-side transcript search, and speaker review require the optional memory service configured with a private token. Keep that service and its storage inaccessible from the public internet, and do not expose its port through Tailscale Serve. Follow [the timeline guide](REMEMBER_TIMELINE.md) before enabling it.

The app records only after a user action. Obtain consent before recording other people and protect local files, server storage, and backups. To remove the HTTPS proxy later, run `tailscale serve --https=443 off` on the computer.

## Participant review in Android 1.1.1

**Corrigir** remains available even when no participant or suggestion exists. Choose **Minha voz** when the account has an enrolled voice, or enter a new participant name and choose **Criar e identificar**. Confirmed/corrected segments attempt to create a reusable reference; short or unsuitable audio keeps the manual decision without a reference. Busy voice comparison is displayed separately from offline state. Install 1.1.1 for these native controls; the backend’s enrolled-voice suggestions also work with 1.1.0.

## Recording reliability in Android 1.1.2

Update the server and install the signed 1.1.2 APK over the existing release; do not uninstall or clear app storage when recordings are pending. The updated app sends the recorded end time, so an offline recording uploaded the next day keeps its real duration. Older completed sessions are not rewritten.

Signing out of the web app preserves valid Android device links. Password/security changes and explicitly unlinking a device still revoke access. If an earlier server version already invalidated a link, sign in to the same account in **PC** and link recordings again in **Ajustes**. Pending audio remains assigned to its original account. Check the upload and transcription settings and keep the computer available until processing finishes.

Web history, search links and the dashboard now follow the browser timezone instead of UTC calendar dates.

## Notifications and startup in Android 1.1.4

Install the signed release APK over the existing release app; keep app storage and pending recordings. Release and development builds have different package IDs, so a development APK does not update the release app. Update the server too, using the normal backup and deployment procedure.

Version 1.1.4 moves startup recovery and scheduling off the main thread and displays loading feedback in the PC tab. It adds native reminder and completed-transcription notifications with a white Brain Core status-bar icon and a monochrome themed launcher icon.

1. Sign in and link recordings to the intended account in **Ajustes**. Reminder synchronization uses this same device link, independently of audio-upload preferences.
2. Allow notifications on Android 13 or newer. In web Settings → **This device**, or native **Ajustes**, test a notification and open Android notification settings to manage channels and sounds.
3. Create a reminder in Notes. The app downloads only scheduling metadata and shows a generic notification that opens Notes. Completed mobile-transcription alerts open the Timeline.

Downloaded reminders are scheduled locally, including daily repeats. Date-only reminders use 09:00 in the phone's timezone. Schedules are restored after reboot, app updates and clock/timezone changes. Unlinking the account cancels its cached alarms and notifications.

Delivery is **inexact**: Android battery restrictions can delay alarms. Background synchronization runs periodically when connected (at least 15 minutes between periodic runs); opening the app and changing notes in its PC tab also requests a refresh. Edits and deletions made on another device take effect after synchronization. Existing downloaded alarms can work offline, but force-stopping the app requires reopening it. This is not an exact-alarm or remote push service.

## Home and Notes organization

The home page offers direct shortcuts, clickable summaries and recent pages. Notes supports All, Lists and Reminders filters, accent-insensitive search (including tags and checklist items), title or update sorting, and progressive loading. A linked note remains reachable even when it is outside the initial batch. These improvements come from the updated server's web frontend.

## Voice identification in Android 1.1.5

Update both the server and the app. The native timeline now preserves the server's voice groups and owner-match indication instead of displaying every unconfirmed group as unidentified. It refreshes completed transcripts when opened; **Atualizar vozes** retries without recording or transcribing again. Cached identification remains available offline, and correction controls open on demand.

The server compares each voice group with the account's enrolled sample and its active, manually confirmed voice references. Several groups may match the same owner; groups no longer compete against each other for a single owner slot. References for other participants can block an ambiguous match. A group with six seconds of speech can be displayed even when ASR produced fewer than three sentences.

**Eu (provável)** is an automatic suggestion, not a confirmed identity or a calibrated probability. Manual corrections take priority, and deleted/revoked references stop contributing. Short, noisy or mixed-speaker audio can still remain unidentified. Naming a whole voice in the web conversation applies to that session; correcting a suitable individual segment can supply a reusable reference. No accuracy percentage is claimed from synthetic tests.
