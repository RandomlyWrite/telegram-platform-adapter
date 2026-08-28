# Telegram Platform Reference for Games

Read this before selecting an integration path. It summarizes stable architectural guidance; consult the linked official documentation for the exact current API shapes and availability.

## Integration decision

| Path | Use case | Key constraints |
|---|---|---|
| **Mini App** | New custom games, direct launches, custom leaderboards/progression, rich social UI, payments, multiplayer. | The game is an HTTPS web app inside Telegram and must integrate the Web App SDK. |
| **Legacy Bot API Game** | A bot sends a game message and the product requires the native game-score mechanism. | The bot opens the game URL by answering a game callback and uses Bot API score methods. |
| **Mini App link in a bot** | A direct, profile-button, menu-button, or inline-button game launch. | Select an entry point deliberately because available context, sharing flow, and UX differ. |

Mini Apps can launch from main app/profile controls, keyboards, inline buttons, menu buttons, inline mode, direct links, and the attachment menu. Direct/main Mini App links can receive a `startapp` value for referral, campaign, room, or challenge routing. The app must validate all sensitive launch data server-side. [1]

## Secure session bootstrap

Use this flow for any user-specific state, score, leaderboard, entitlement, purchase, or social feature.

1. Load the Telegram Web App SDK and call the appropriate ready/viewport setup through the adapter.
2. Read raw `Telegram.WebApp.initData` on the client. Do not trust `initDataUnsafe` for authorization.
3. POST raw `initData` to a server endpoint over HTTPS.
4. Verify Telegram's documented HMAC signature on the server using the bot token or approved third-party validation method; validate the `auth_date` freshness window and reject malformed, replayed, or expired data. [2]
5. Create an application session only after verification. Return a minimal session profile and server-issued token.
6. Associate saves, leaderboards, purchases, and rewards with the server session. Apply authorization, idempotency, and rate limiting to every write.

> **Never use `initDataUnsafe.user.id` or a client-submitted score as the authority for prizes, paid items, rankings, or wallet-like balances.**

Do not send bot tokens to browser code, logs, build variables exposed to the client, screenshots, or version control. Redact raw launch data in error reporting and test documents.

## Mini App client contract

Construct an adapter around the official `Telegram.WebApp` object. Keep game code independent of Telegram globals. Implement the adapter methods only when the game needs them, and feature-detect every optional capability.

| Concern | Adapter behavior |
|---|---|
| Startup | Call Telegram-ready methods safely; provide a normal-browser mock mode. |
| Layout | Read viewport data; update on viewport/theme/safe-area events; expose CSS-safe content bounds. |
| Theme | Map Telegram theme values to CSS variables. Use semantic variables instead of hard-coded light colors. |
| Lifecycle | Pause audio/timers and reduce rendering when inactive; resume predictably without double-awarding or double-submitting. |
| Fullscreen/orientation | Use only for games that benefit. Gracefully continue if request fails or is unsupported. |
| Haptics/motion | Feature-detect, request only after an explicit player action where appropriate, and provide non-sensor controls. |
| Storage | Treat device/cloud storage as convenience state, not authoritative currency, entitlement, or score data. |
| Navigation | Integrate back-button and close/exit confirmation deliberately; never trap users in the app. |
| Sharing | Build server-validated challenge/referral payloads; do not award on a client claim alone. |

Telegram recommends responsive, mobile-first interfaces, smooth animation, dynamic theming, accessible labels, and safe-area support. Fullscreen Mini Apps can use portrait or landscape, while safe-area and content-safe-area signals help prevent UI collisions. [1] [3]

## Client and performance baseline

Target quick input feedback and a stable frame rate on lower-end phones. Apply a simple quality ladder: reduced particles/effects, smaller render scale, conservative texture sizes, and pausing work when not active. Ensure there is a playable non-fullscreen fallback. Test the declared orientations, dark and light themes, small safe-area devices, and interrupted sessions.

Do not assume every user has the latest Telegram client. Check the documented version/capability mechanism before calling newer APIs and preserve core playability when optional features are absent. [1]

## Bot, distribution, and backend

| Requirement | Implementation note |
|---|---|
| Main Mini App | Configure the bot's primary app and production HTTPS URL; use a direct link to test launch parameters and public distribution. |
| Menu/inline launch | Configure the appropriate `web_app` button and verify its contextual behavior. |
| Bot updates | Receive Bot API updates through a protected HTTPS endpoint. Set and verify a webhook secret token if webhooks are used. [4] |
| Legacy game launch | Send the game; answer the resulting game callback with the game URL; implement server-side score updates and retrieval. [4] |
| Scoreboard | Use a custom authoritative leaderboard for Mini Apps unless the project explicitly selects legacy Bot API Games. |
| Payments | Model entitlements server-side. Verify provider/Bot API events, make purchase processing idempotent, and test cancellation/retry flows. |
| Real-time rooms | Make the server authoritative for room membership and moves. Validate every message; do not rely on a client-owned WebSocket state. |

When a game needs a webhook, server validation, database, commerce, matchmaking, or real-time state, choose a persistent, managed backend rather than a static-only site. Keep its URL, webhook state, and credentials location in `INTEGRATION_STATUS.md` without storing secrets there.

## Legacy Games API checklist

Use this only for an explicit legacy-game choice. Follow the current Bot API documentation for request fields and limitations.

1. Create/configure the game through the bot workflow.
2. Send the game message with `sendGame`.
3. Include a `callback_game` launch button in the required position.
4. Handle the game callback query and call `answerCallbackQuery` with the HTTPS game URL.
5. Submit scores from the server using `setGameScore`, then retrieve/display scores through the documented game-score method.
6. Test a genuine Telegram chat message, callback, launch, score update, and scoreboard.

## Official sources

[1]: https://core.telegram.org/bots/webapps "Telegram Mini Apps"
[2]: https://core.telegram.org/bots/api#validating-data-received-via-the-mini-app "Telegram Bot API: Validating data received via the Mini App"
[3]: https://telegram.org/blog/fullscreen-miniapps-and-more "Telegram: Mini Apps 2.0"
[4]: https://core.telegram.org/bots/api#games "Telegram Bot API: Games"
