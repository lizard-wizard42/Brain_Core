# Maintainer workflow

## Repository boundary

`Brain_Core` is the public codebase. It must contain only reusable source,
documentation, fictional examples, and safe configuration templates.

Do not add database dumps, `.env` files, uploads, backups, private URLs, local
paths, credentials, cookies, API tokens, SSH material, or real user content.

Use one public repository for reusable code. Keep the operational installation
in a separate runtime directory, with its environment, data and backups ignored
by Git. A second private code repository is not required. Never publish the
private installation's commit history as part of consolidation.

## Public contribution flow

1. Create a branch from `main`, such as `feat/graph-view`.
2. Make the change without using real data or private environment files.
3. Run `bash scripts/public-release-check.sh`, backend tests, frontend tests,
   and the frontend build.
4. Open a pull request, review the diff as if it were visible to anyone, and
   merge only after the GitHub workflow is green.

Contributors use forks and pull requests. Maintainers decide what is merged;
public visibility does not grant write access.

## Commit attribution

Keep human authors and collaborators credited. Automated agents must not add
co-author trailers. The repository's agent settings disable automated attribution,
and the public-release workflow checks the complete branch history for known
agent identities.

Enable the local commit-message guard after cloning:

```bash
git config core.hooksPath .githooks
```

The guard rejects known agent co-author identities without removing human
co-authors. Historical message corrections preserve file trees, human identities,
dates and merge topology, but necessarily change commit IDs and invalidate
signatures on affected commits. Keep a private recovery bundle before rewriting
published history, and push only the intended ref with an explicit lease.

## Moving a private improvement into public code

Do not push a private branch or private commit directly to this repository.
Instead, create a new public branch, copy only the generic source changes, and
review the complete diff. Replace instance values with environment variables,
examples, or documentation before committing.

## Using a public improvement privately

After a public PR is merged, apply the reviewed code to the local
installation. Before deploying it, back up the local database and uploads, run
the tests, build the artifacts, then restart only the intended service.

## Credential rotation

If a credential was ever present in a private dump or configuration, rotate it
at its issuing system. At minimum review database credentials, JWT signing
secret, API tokens, messaging-bot tokens, and server/SSH access. Never place a
replacement credential in a commit or pull-request discussion.
