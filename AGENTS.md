# Agent Guardrails (Brain Core)

This file defines mandatory rules for any coding agent working in this repository.

## Frontend Source Of Truth

- Edit only source files under `frontend/src/` (and config/scripts when required).
- Never manually edit generated artifacts:
  - `frontend/dist/`

## Build Target

- Standard web target (`/`): output is `frontend/dist/`
- Default frontend build (`npm run build`) produces this target.

## Mandatory Validation Checklist (Frontend)

1. Implement change in `frontend/src/...`
2. Run `cd frontend && npm run build`
3. Confirm output HTML file was updated:
   - `frontend/dist/index.html`

## Publish Flow

- Use `./build.sh` for production publish flow.
- This script is the canonical way to keep backend + frontend bundles aligned.
