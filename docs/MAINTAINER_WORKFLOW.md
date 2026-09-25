# Maintainer workflow

## Repository boundary

`Brain_Core` is the public codebase. It must contain only reusable source,
documentation, fictional examples, and safe configuration templates.

Do not add database dumps, `.env` files, uploads, backups, private URLs, local
paths, credentials, cookies, API tokens, SSH material, or real user content.

The maintainer's operational installation belongs in a separate private
repository and separate runtime directory. It is not a remote for this checkout.

## Public contribution flow

1. Create a branch from `main`, such as `feat/graph-view`.
2. Make the change without using real data or private environment files.
3. Run `bash scripts/public-release-check.sh`, backend tests, frontend tests,
   and the frontend build.
4. Open a pull request, review the diff as if it were visible to anyone, and
   merge only after the GitHub workflow is green.

Contributors use forks and pull requests. Maintainers decide what is merged;
public visibility does not grant write access.

## Moving a private improvement into public code

Do not push a private branch or private commit directly to this repository.
Instead, create a new public branch, copy only the generic source changes, and
review the complete diff. Replace instance values with environment variables,
examples, or documentation before committing.

## Using a public improvement privately

After a public PR is merged, selectively apply the reviewed code to the private
installation. Before deploying it, back up the local database and uploads, run
the tests, build the artifacts, then restart only the intended service.

## Credential rotation

If a credential was ever present in a private dump or configuration, rotate it
at its issuing system. At minimum review database credentials, JWT signing
secret, API tokens, messaging-bot tokens, and server/SSH access. Never place a
replacement credential in a commit or pull-request discussion.
