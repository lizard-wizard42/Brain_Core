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
