# Agent Instructions

## Do not upload automatically

- Do **not** run `git push`, `git push --tags`, create GitHub tags/releases, or update remote branches unless the user explicitly asks in the current request.
- Do **not** upload files through the GitHub API or any other remote service automatically.
- Local commits are allowed when they are part of the requested change, but they must not be pushed without an explicit command.

## Do not package automatically

- Do **not** run `npm run dist:win`, `npm run dist:portable`, `npm run package:win-zip`, `npm run dist:mac`, or equivalent packaging after every edit.
- Packaging is expensive and should wait for an explicit user request.
- Multiple edits should be allowed to accumulate; package only when the user asks for a build/release.

## Verification

- Type checking and focused unit tests are fine while iterating.
- Do not run the full E2E suite after every change; use it only when requested or when the change specifically needs it.
- Never claim tests/builds passed without checking the actual result.
