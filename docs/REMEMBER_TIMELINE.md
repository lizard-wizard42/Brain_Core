# Experimental timeline and companion recorder

## What it is

Timeline (shown in the interface as **Memória** or **Linha do tempo**) is a
personal chronological view of captured sessions. It can show recording status,
sessions by day, transcripts, search results, and speaker labels. Sessions can
also be turned into notes or reminders inside Brain Core.

## What records audio

Brain Core's web interface does not perform continuous microphone capture. The
timeline expects a separate Android companion recorder to capture audio and a
local processing service to transcribe and store the resulting sessions. That
service may use local GPU processing for transcription. Brain Core talks only
to the service through its backend proxy.

The short microphone capture in the **voiceprint** panel is different: it is an
optional, one-off sample used to help identify the account owner's voice in
already captured transcripts.

## Current status

This integration is experimental and still under development/testing. The
Android companion APK, device onboarding, and parts of the recording workflow
are not part of the standard Docker distribution. A fresh Docker installation
intentionally keeps the integration offline; an empty timeline or an unavailable
recorder control in that mode is expected behavior, not a failed Brain Core
installation.

The private integration settings are intentionally not documented as a public
installation path yet. Keep any future recorder-service address or access token
in a private `.env` file only, never in Git. The service should stay on a trusted
local network unless it has appropriate transport security and access controls.

## Privacy and consent

Timeline data may contain conversations, voices, transcripts, and information
about other people. Before recording, obtain consent where required, use a
retention policy, and protect backups just as carefully as the live database.
This repository is for a personal self-hosted instance; it does not provide a
multi-user privacy boundary for the companion recorder corpus.

## Scope of Brain Core

Brain Core provides the interface and backend proxy for viewing, searching, and
organizing sessions. It does not ship an APK, start an Android recording service,
or upload recordings to a cloud provider by default.
