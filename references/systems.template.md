# SYSTEMS.md template

Create this during scaffolding and keep it current. Build top to bottom unless a documented dependency requires an order change. Do not mark a system `done` until it passes the browser and applicable Telegram-client checks.

```markdown
# Systems

| # | System | Status | Test notes |
|---|---|---|---|
| 1 | Telegram platform adapter and normal-browser mock | pending | |
| 2 | Responsive game shell, theme variables, and safe-area layout | pending | |
| 3 | Input abstraction and accessibility fallback | pending | |
| 4 | Core movement/interaction | pending | |
| 5 | {Genre-defining mechanic and round loop} | pending | |
| 6 | Rendering, asset loading, and performance quality ladder | pending | |
| 7 | Pause/resume, lifecycle handling, and recovery | pending | |
| 8 | Secure Mini App session validation or legacy-game callback path | pending | |
| 9 | Progression/score submission with server-side validation | pending | |
| 10 | {Leaderboard, cloud saves, rewards, or inventory if in scope} | pending | |
| 11 | {Sharing/challenges/referrals/multiplayer if in scope} | pending | |
| 12 | {Fullscreen, orientation, haptics, motion, storage if useful} | pending | |
| 13 | {Telegram Stars/payment flow if in scope} | pending | |
| 14 | Bot launch/distribution configuration and production integration test | pending | |
| 15 | Release telemetry, errors, and rollback readiness | pending | |

Status values: `pending` / `building` / `testing` / `done` / `blocked`.

## Test-log rules

For every test, write one factual line in the relevant row: environment/client, action, observed outcome, and pass/fail. Retain failed attempts. Redact tokens, raw `initData`, private user data, and payment payloads.

## Dependency changes

| Date | Change | Reason |
|---|---|---|
| {YYYY-MM-DD} | {System moved/added/removed} | {Actual dependency or approved scope change} |
```

Remove irrelevant rows and add systems demanded by `TELEGRAM_GAME_SPEC.md`. A local-only game may omit server validation and social rows; a real-time game needs room authority, reconnection, and moderation rows.
