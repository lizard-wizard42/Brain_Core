# Contributing to Brain Core

Thanks for helping improve Brain Core. The project is a self-hosted workspace for notes, attachments, recordings, and personal knowledge. Contributions should keep setup understandable and leave users in control of their data.

## Start here

1. Check existing issues before starting a large change. Open an issue for a new feature or a change to storage, authentication, recording, or deployment so the design can be discussed first.
2. Read [AGENTS.md](AGENTS.md) for source and build rules. Edit source files, not generated bundles or APKs.
3. Run the project locally with [the Docker quick start](README.md#quick-start), or use the development setup in the README. Use fictional sample content when testing screenshots, imports, or transcript flows.
4. Keep a pull request focused on one problem. Explain the behavior before and after your change, the checks you ran, and any migration or configuration steps.

## Where to work

| Area | Main paths | Check before opening a PR |
| --- | --- | --- |
| Web interface | `frontend/src/` | `npm run lint`, `npm test`, `npm run build` in `frontend/` |
| API and database | `backend/src/`, `backend/test/` or `backend/tests/` | `npm run build`, `npm test` in `backend/` |
| Android companion | `android/app/src/` | `./gradlew :app:testDebugUnitTest :app:assembleDebug` in `android/` |
| Transcription service | `services/memory/`, `services/gpu-worker/` | Run the relevant unit tests and describe the model/runtime used; see the [GPU worker guide](services/gpu-worker/README.md) |
| Local MCP | `mcp/`, `backend/src/routes/agent.ts`, `backend/src/routes/integrations.ts` | `npm test --prefix mcp`; `node scripts/test-agent-postgres.mjs` (disposable PostgreSQL) |
| Documentation | `README.md`, `docs/` | Check links, commands, and a fresh-install path |

Install JavaScript dependencies with `npm ci` in the affected package. Backend tests may require a local test `JWT_SECRET` of at least 32 characters; never use a production secret. If a check cannot run in your environment, say which one and why in the PR.

## Design expectations

- Keep external services optional and explicitly configured. A standard installation should work for notes and attachments without cloud accounts or transcription hardware.
- Preserve account ownership for pages, uploads, devices, recordings, and transcripts. Add tests for authorization boundaries when changing an API.
- Treat audio and transcripts as sensitive data. Recording must remain a user action, and UI copy should make queueing, deletion, and transcription status clear.
- Document database migrations, new environment variables, and operational changes. Prefer safe defaults for a fresh Docker installation.
- Keep the interface usable on desktop and Android. Describe any visual change with screenshots made from fictional data.

## Privacy and security

Do not include `.env` files, keys, databases, uploads, recordings, real transcripts, personal screenshots, or generated build artifacts in a PR. Use placeholders for server addresses and credentials. Review the diff and commit history before pushing, including image metadata and APK contents when relevant.

Before committing to a public branch, configure Git to use your own
[GitHub-provided `noreply` address](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)
and check both author and committer metadata. Do the same for any
`Co-authored-by` trailer when a collaborator wants their address kept private.
The release check also checks author/committer emails and automated-agent coauthor trailers in commit history; a clean file diff alone is not enough.

If you find a vulnerability or accidental exposure, follow the private reporting process in [SECURITY.md](SECURITY.md) instead of posting exploit details in a public issue.

## Pull request checklist

- [ ] The PR explains the user-visible change and any limits.
- [ ] Relevant tests and builds passed, or the PR explains what could not be run.
- [ ] New configuration and migrations are documented with safe defaults.
- [ ] The diff contains only source, documentation, and fictional test data.
- [ ] The PR calls out any impact on authentication, persistent data, recording, or deployment.


## Offline service checks

Install `services/memory/requirements-test.txt` in a test venv and run `CELTWO_MEMORY_EMBEDDER=stub python -m pytest services/memory/tests -q`. Tests create temporary SQLite databases and synthetic audio. Use `node --test scripts/test_backup_sources.test.mjs` and `python3 -m unittest discover -s scripts -p test_snapshot_memory.py` for backup behavior. `node scripts/test-agent-postgres.mjs` starts a disposable PostgreSQL cluster over a Unix socket; it never uses the installation database and exercises all 12 MCP tools.

Update [CHANGELOG.md](CHANGELOG.md) and the corresponding guides for new configuration, permissions or persistence. The canonical build is `./build.sh`; same-origin native deployments additionally use `npm run build:same-origin --prefix frontend`. Required CI checks must pass before merging.
