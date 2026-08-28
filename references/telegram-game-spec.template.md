# TELEGRAM_GAME_SPEC.md template

Create this at the end of discovery. Every field must reflect an actual user decision or a clearly labeled open question. Update it whenever scope changes.

```markdown
# Telegram Game Specification

## Core loop

{One paragraph: what players do moment to moment, what creates challenge or progression, and how a session ends or loops.}

## Game type and presentation

| Field | Decision |
|---|---|
| Genre | {User wording} |
| View | {2D / 3D / UI-driven} |
| Art approach | {Placeholder / pixel / vector / supplied assets / other} |
| Orientation | {Portrait / landscape / adaptive} |
| Input | {Touch, keyboard/mouse support, motion if used, accessibility alternatives} |
| Session target | {Typical round length and pause/resume expectation} |

## Telegram launch and distribution

| Field | Decision |
|---|---|
| Integration model | {Mini App / legacy Bot API Game / browser demo first} |
| Primary entry point | {Profile/main app, menu, inline button, direct `startapp` link, legacy game message} |
| Deep-link parameters | {Allowed server-validated parameters and their purpose} |
| Sharing/challenge flow | {None or exact player flow} |
| Supported Telegram clients | {Mobile OS/app versions, Desktop, Web as applicable} |

## Social, account, and progression

| Field | Decision |
|---|---|
| Social model | {Solo / leaderboard / asynchronous challenge / shared room / real time} |
| Identity model | {Guest/demo / verified Telegram session / additional account linking} |
| Progress | {Session-only / local convenience state / server cloud save} |
| Leaderboard | {None / custom authoritative / legacy game scoreboard} |
| Anti-cheat level | {Prototype / basic server checks / server-authoritative} |

## Economy and policy-sensitive mechanics

{Free-only, cosmetics, energy, premium access, Telegram Stars, subscriptions, prizes, chance-based mechanics, or an explicit “none.” Record server authority, fulfillment, idempotency, and verification requirements for any purchase/reward.}

## Backend trust boundary

{List each server-issued authority: validated Telegram identity, session tokens, score acceptance, save writes, inventory/rewards, payment events, referrals, rooms/moves, moderation. Explicitly state what remains untrusted client input.}

## Scope and success criteria

| Field | Decision |
|---|---|
| Scope | {Quick prototype / polished small launch / other} |
| Required end-to-end flow | {Exact launch-to-finish player flow that must work} |
| Performance target | {Client/device class and target experience} |
| Explicit non-goals | {Out-of-scope features} |

## Open questions and assumptions

{Only unresolved items. Do not silently convert these to decisions.}
```
