---
name: telegram-games
description: >-
  Use when the user wants to build, prototype, architect, integrate, test, or
  deploy an HTML5 game for Telegram — including Telegram Mini App games,
  bot-launched games, deep-link game launches, custom leaderboards, Telegram
  Stars game purchases, or legacy Bot API Games. Enforces discovery,
  secure Mini App identity handling, bot/distribution setup, system-by-system
  implementation, and real Telegram client verification.
license: MIT
---

# Telegram Games — Build, Integrate, and Verify

## Scope and default

Build **HTML5 games that run inside Telegram**. Default to a **Telegram Mini App game** launched by a bot. Use the legacy **Bot API Games** flow only when the user explicitly needs Telegram's native game-message/high-score API, or has an existing implementation that uses it.

Do not silently recast a native Unity, Unreal, or Godot game as a Mini App. Explain that this workflow targets web technology, then ask whether an HTML5 port or companion Mini App is acceptable. Do not treat a normal website as a finished Telegram game merely because it has a link.

Read `references/telegram-platform.md` before choosing an integration path and `references/testing-protocol.md` before testing. Use the specification and systems templates in `references/`. Copy `templates/telegram-platform-adapter.ts` for the client boundary, then copy `templates/telegram-init-data-verifier.ts` and `templates/express-telegram-auth-router.ts` when implementing verified Mini App sessions.

## Non-negotiable rules

| Area | Requirement |
|---|---|
| Identity | Treat `Telegram.WebApp.initDataUnsafe` as display-only client data. Send the original `initData` to the server and validate it before creating an authenticated session or granting rewards. |
| Secrets | Keep bot tokens, payment credentials, signing keys, and privileged Bot API calls server-side only. Never bundle them in browser code or commit them to the repository. |
| Game integrity | Treat client scores, currencies, inventory, referral rewards, and purchase results as untrusted. Validate gameplay-relevant state on the server where a competitive or monetized feature exists. |
| Compatibility | Implement a small Telegram platform adapter with a safe browser mock. Feature-detect optional methods; the game must not crash outside Telegram during development. |
| UX | Design mobile-first, react to Telegram theme and viewport changes, and honor safe-area insets. Request fullscreen, orientation lock, motion, haptics, or storage only when useful and supported. |
| Delivery | Use a deployed HTTPS origin and configured bot URL for real-client verification. Local browser testing is necessary but not proof of Telegram integration. |
| Build discipline | Implement and test exactly one system at a time. Do not mark a system complete based on code review alone. Commit each verified system separately. |

> **Security boundary:** A Telegram display name, client-provided user ID, query parameter, local record, or submitted score is not proof of identity or entitlement.

## Phase 0 — Resume and existing-project check

Inspect the project before changing it.

1. If `TELEGRAM_GAME_SPEC.md` exists, read it together with `SYSTEMS.md` and `PLAYTEST.md` when present. Treat this as a resumed build. Identify the first system that is not `done`, summarize the state to the user, and continue there.
2. If a project exists but no Telegram-game documents exist, inspect its framework, game loop, deployment model, and Telegram integration. Preserve the project. Run discovery and create the documents around the existing code.
3. If neither exists, proceed as a new game.

Do not scaffold over an established project. Do not repeat discovery if the specification is complete.

## Phase 1 — Discovery interview

Ask these first-round questions together. Offer practical options, but allow freeform answers.

1. **Game and core loop:** What do players repeatedly do, and what makes a session satisfying? Confirm it in one sentence.
2. **Telegram launch surface:** Main Mini App/profile button, menu button, direct `startapp` link, inline/chat sharing flow, or a legacy game message? Recommend the default only after hearing the distribution goal.
3. **Social model:** Solo, asynchronous leaderboard, chat challenge, shared-room/co-op, or real-time multiplayer?
4. **Controls and presentation:** Portrait or landscape; touch-only or touch plus desktop keyboard/mouse; 2D, 3D, or UI-driven game?
5. **Account and progress:** Ephemeral sessions, local-only progress, Telegram-identified cloud saves, or cross-device/cross-platform accounts?
6. **Commercial model and scope:** Free prototype, polished launch, cosmetics/energy/premium content, or Telegram Stars purchases/subscriptions? Ask whether it includes prizes, chance-based mechanics, or real-world value before designing a commerce flow.

Ask two to four game-specific second-round questions. Clarify run length and failure loop for runners; turn model and challenges for puzzles; server authority and matchmaking for multiplayer; or economy sources/sinks and anti-cheat tolerance for idle games.

Write `TELEGRAM_GAME_SPEC.md` using `references/telegram-game-spec.template.md`. Record actual decisions rather than silently filling unspecified fields. This is the source of truth; request approval before expanding beyond it.

## Phase 2 — Choose the integration and architecture

### Select the Telegram model

| Model | Choose it when | Required focus |
|---|---|---|
| **Mini App game** | Default for new games, custom UI, direct links, rich progression, social features, payments, or multiplayer. | Web App SDK adapter, secure `initData` validation, bot launch configuration, and a backend/leaderboard when needed. |
| **Legacy Bot API Game** | The user explicitly wants a game message and Telegram's built-in game-score mechanism. | `sendGame`, `callback_game` launch handling, `answerCallbackQuery` URL response, and Bot API score methods. |
| **Browser demo first** | The user wants to validate a core loop before Telegram setup. | Keep the adapter mockable, but label it a demo; do not claim Telegram identity, scores, payments, or launch behavior is complete. |

### Select hosting and server responsibilities

A real Mini App game generally needs a server when it has identity, cloud saves, leaderboards, referral rewards, commerce, moderation, multiplayer, or bot updates. Prefer a full-stack web project in these cases so the game, API, database, and encrypted secrets stay together. Use a static site only for offline/demo gameplay without trusted user state.

When the game needs a bot webhook, scheduled reset, live room, or long-running process, assess deployment architecture before coding it. Use an HTTPS webhook handler for Bot API updates; use an always-on service only when real-time state requires it. Do not use an ephemeral environment to receive production bot callbacks.

### Define the platform boundary

Create a narrow platform adapter rather than scattering `window.Telegram` calls throughout game code. It must cover initialization and `ready()`/viewport setup; theme and safe-area values; launch parameters and validated-session bootstrap; lifecycle handling; optional fullscreen, orientation, haptics, storage, sharing, and back button behavior; and a browser-development mock with no elevated trust.

Keep game systems dependent on this adapter interface, not the Telegram global. Copy the backend verifier and Express router templates rather than improvising an HMAC flow. Establish a backend endpoint that receives raw `initData`, verifies it, checks freshness, and returns only required game-session data. Define rate limits and idempotency for score submissions and purchase/reward callbacks before implementing an economy.

State the selected architecture and its reason to the user. Request BotFather configuration or credentials only when they block the next real integration step. Do not ask users to paste a long-lived bot token into chat when a secure project-secret flow is available.

## Phase 3 — Scaffold the game and QA harness

For a new project, scaffold the selected web stack. Separate the game app, platform adapter, backend API, and bot integration. For existing projects, map this layout onto the current code without replacing working components.

Create and maintain these root files:

| File | Purpose |
|---|---|
| `TELEGRAM_GAME_SPEC.md` | Player experience, Telegram launch/distribution, trust model, and scope. |
| `SYSTEMS.md` | Ordered build status and factual test log. |
| `PLAYTEST.md` | End-to-end findings for browser and Telegram-client tests. |
| `INTEGRATION_STATUS.md` | Bot configuration, deployed origin, credential location, tested clients, and pending external setup; never include secrets. |

Build a persistent dev route or scene with deterministic test controls, state reset, and platform diagnostics. It must work in a normal browser through the mock adapter and state clearly that the session is simulated. Add fixtures for a valid backend-issued session, expired/invalid launch data, theme values, safe-area values, and small mobile viewports.

Create `SYSTEMS.md` from `references/systems.template.md`, tailoring it to the game. Show the order to the user before Phase 4. Initialize version control if needed.

## Phase 4 — System-by-system build loop

Work from the top of `SYSTEMS.md`, one system only. A useful Mini App default order is:

1. platform adapter, mock mode, and startup/lifecycle diagnostics;
2. game shell, responsive layout, theme variables, and safe-area handling;
3. input abstraction and core player interaction;
4. genre-defining loop;
5. rendering, performance budget, and asset loading;
6. pause/resume, error recovery, and state reset;
7. authenticated session bootstrap and trustworthy progression/score API;
8. leaderboard, cloud save, or reward systems when in scope;
9. sharing, chat challenge, referral, or multiplayer features when in scope;
10. optional haptics, fullscreen, orientation, motion, storage, or monetization;
11. bot launch/distribution wiring and release instrumentation.

For each system, set status to `building`, implement it, run the applicable protocol, and log the exact result. If testing fails, fix the same system and retest. Only after a real pass may it become `done` and receive a focused version-control commit. Record any order change and its dependency reason in `SYSTEMS.md`.

## Phase 5 — Verify in a browser and in Telegram

Follow `references/testing-protocol.md` after every system. Minimum verification includes a normal-browser mock test, mobile-size interaction test, console/network review, and comparison with the expected outcome in `SYSTEMS.md`.

For every Telegram-dependent system, deploy to the intended HTTPS origin and verify it from Telegram itself. Test the configured launch surface; theme behavior; expansion/fullscreen behavior if used; safe areas; background/foreground recovery; server validation; deep links and start parameters; and an actual score/progress round trip. Test every client platform declared by the user—at least one mobile client for touch-first games, plus desktop if supported.

For legacy Bot API Games, also test the game message, game callback response, loaded game URL, server-side score update, and scoreboard. Do not substitute a browser mock for Bot API interactions.

Never log raw `initData`, bot tokens, purchase payloads, or complete user records in screenshots, source files, analytics, or `PLAYTEST.md`.

## Phase 6 — Assemble, release-check, and hand off

Once every individual system passes, run a full session from the Telegram entry point through the declared end state. Test cold launch and resume; an interrupted/reconnected session; an invalid or expired identity attempt; a duplicate score/reward request; and every social, leaderboard, or purchase path in scope. Log outcomes and open issues in `PLAYTEST.md`.

Before declaring the game ready, confirm that the final HTTPS origin is configured for the bot, the bot launches the game through the chosen surface, project secrets are not exposed, server validation is enabled, and the user has a launch/rollback checklist. Ask the user for confirmation before production BotFather changes or an action that sends/changes visible bot content.

## Ongoing discipline

Re-read `TELEGRAM_GAME_SPEC.md`, `SYSTEMS.md`, and `INTEGRATION_STATUS.md` at the start of each later session. Update them whenever the user changes the game, launch surface, backend trust boundary, or monetization design. Treat a new feature as a scoped change, not a silent addition.

## References

[1]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
[2]: https://core.telegram.org/bots/api#games "Telegram Bot API: Games"
[3]: https://core.telegram.org/bots/api#validating-data-received-via-the-mini-app "Telegram Bot API: Validating data received via the Mini App"
[4]: https://telegram.org/blog/fullscreen-miniapps-and-more "Telegram: Mini Apps 2.0"
[5]: https://github.com/Sudhanshu5669/Html5-Gamedev-Skill "Source inspiration: HTML5 Game-Dev Skill (MIT)"
