# MNEMO design system

## Overview

MNEMO is a static, wallet-connected memory vault and chat client. The established identity is sky-blue paper, dark ink, orange seals, Newsreader headings and Spline Sans Mono text. The home story explains the same product that the Vault, Chat, Agents and Trade routes operate; its capsule is the single visual motif.

The implementation lives in `web/src/styles.css`, with locally bundled fonts imported by `web/src/main.tsx`. Keep the existing identity when adding a page. Validation and browser evidence are in `docs/review/validation.md`.

## Colors

These are the actual CSS custom properties in `web/src/styles.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#e9f1f7` | Page background |
| `--surface` | `#f6fafd` | Vault panels, sample note, secondary controls and wallet sheet |
| `--ink` | `#0f1a26` | Primary text, structural edges and focus rings |
| `--ink-2` | `#3a4a5c` | Hints, metadata and ciphertext |
| `--accent` | `#ff5b2e` | Primary action, current-nav underline and the capsule seal |
| `--danger` | `#a3260a` | Error text, always accompanied by a message |
| `--ok` | `#1d5c36` | Confirmed transaction text |

Inputs and hovered neutral controls use white. Primary hover uses `#ff7550`. The modal backdrop is `rgb(15 26 38 / 0.45)`. There is one light theme. The design probe measures resolved solid text/background pairs; see validation for the checks and their limits.

## Typography

- `--font-head`: Newsreader, Georgia, Times New Roman, serif; local 600 face. Used for headings, the header brand and footer wordmark.
- `--font-mono`: Spline Sans Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; local 400 and 500 faces. Used for body text, labels, controls, numbers and code. Monospaced prose is an incumbent brand choice, retained deliberately.
- Tokens: `--fs-sm: 13px`, `--fs-body: 15px`, `--fs-lg: 18px`, `--fs-h2: 24px`, `--fs-page: 34px`, `--fs-h1: clamp(34px, 6vw, 52px)`.
- Form inputs use 16px to avoid iOS focus zoom. The footer wordmark is a distinct brand treatment, `clamp(76px, 21vw, 230px)`, rather than another content-heading size.
- Body line height is 1.55; code and textareas use 1.5; headings use 1.1. Headings balance, short prose uses pretty wrapping, and long values use `overflow-wrap: anywhere`. Changing numbers use tabular figures through `.num`.
- The footer wordmark has `-0.055em` tracking; normal content retains natural spacing. Prose measures generally stay within 64–70 characters.

The production export contains WOFF2 files and the WOFF fallbacks referenced by the font CSS. No external font service is needed.

## Layout

`--max: 1080px` aligns header, main and footer. Main has 16px inline padding and a 24px gap. The spacing tokens are 4, 8, 12, 16, 24 and 40px (`--space-1` through `--space-6`). Story sections use a 40px vertical inset, increased to 52px at 760px, with a single separating rule.

- Below 760px, the header has brand/connect on the first row and navigation beneath. Hero copy and its action precede the 150px canvas. The primary action fits the first 390×844 screen.
- At 600px, the model list becomes two columns and the sample's minimum content height changes from 220px to 150px.
- At 640px, the wallet sheet moves from the bottom edge to the center.
- At 760px, hero copy and a 320px canvas sit side by side, the three steps share a row, story headings rise from 24px to 34px, and the footer becomes two columns.
- At 900px, Chat becomes a 2:1 grid with a sticky memory panel. Its mobile DOM order is conversation, then memory panel.
- Below 360px, step drawings and sample padding shrink. Grids use `minmax(0, …)` or explicit `min-width: 0`; action rows wrap.

The boundary table stays in two equal columns at every width. Addresses wrap without truncation and remain copyable. The home script wraps long lines and scrolls vertically within 480px; the existing Agents code block is keyboard-focusable and can scroll internally. The page itself has no horizontal scroll at the tested 320, 390, 500 and 1440px widths.

## Elevation & depth

Panels have a flat 2px ink edge and no shadow. Buttons retain the existing inset 2px ink ring and hard `2px 2px 0 0` ink shadow; pressing offsets the button by 2px and removes the outer shadow. Story sections use space and a single rule, without nesting bordered cards. Only the wallet sheet overlays the page (`z-index: 40`); the skip link sits above it (`50`).

## Shapes

Controls, panels and fields have square corners. Capsule outlines, small dots and the round seal belong to the illustrations, not the control system. Step drawings use one 1.5px stroke and the existing signal orange. Avoid introducing rounded pills, gradients or a second illustration language.

## Components

| Component/pattern | Source | Behavior and reuse |
| --- | --- | --- |
| `Hero`, `VaultPanel` | `web/src/Home.tsx` | Existing open/connect/switch/chat action, editable notes, stamp and balance. Seal controls share the vault's pending lock. |
| `Capsule` | `web/src/Capsule.tsx` | Dots gather for 4.2 seconds, then stop. Opening the vault snaps them into place in 420ms and adds an orange seal. Changes to reduced-motion preference render a static state. |
| Story sections | `web/src/Story.tsx` | `.story`, `.section-intro`, step drawings, model list, boundary table and agent script follow the same alignment and spacing. |
| `SampleNote` | `web/src/Story.tsx` | An explicitly marked local example uses the existing note encryption/decryption functions with a fresh in-memory sample key. The unseal button becomes a disabled confirmation. No wallet or transaction. |
| `CopyButton` | `web/src/ui.tsx` | Copies exact script/address text; displays Copied, announces status, or shows a selectable-text fallback instruction on failure. |
| `TxStatus` | `web/src/ui.tsx` | Stable polite status region for checking, wallet, pending, confirmed and failed states, with explorer links when available. Chat keeps it outside the proposal list so confirmation remains visible. |
| Chat settings/session | `web/src/chat-state.tsx`, `web/src/Chat.tsx` | State survives hash-route changes. Provider/endpoint changes clear the active key. Remembered keys are scoped by provider and origin, with explicit restore after a change. Conversations and drafts stay in tab memory. |
| `ConnectSheet` | `web/src/ConnectSheet.tsx` | Existing wallet options and connection behavior. Modal background is inert, Tab/Shift+Tab wrap inside, Escape/backdrop/close dismiss, and focus returns to the triggering control. |
| Navigation/skip | `web/src/App.tsx` | Existing four hash routes; current page has an underline. Skip focuses and scrolls the current main without modifying the hash. |
| FAQ | `web/src/Home.tsx` | Native details/summary with its visible native marker, 44px minimum target and keyboard interaction. |
| `Footer` | `web/src/Story.tsx` | Large wordmark, route/docs links, full verified token/vault addresses with copy controls, and the no-backend/no-analytics line. |

Buttons have rest, hover, pressed, focus and disabled styles. Keyboard focus is a 2px ink outline with a 2px offset. Inputs have real labels. `.hint`, `.note-err`, `.tx-error` and `.tx-done` carry text as well as color. Button transitions are named properties at 120ms; reduced motion removes them. `Unscramble` reveals text over 24×30ms or immediately under reduced motion.

## Do's and don'ts

- Start a new route with the existing `main`, `.panel`/`.stack` patterns and the current token scale. Use `.story` for explanatory home sections.
- Use a native link for routes and a button for actions. Keep the skip link outside hash routing.
- Keep API credentials out of component-local route state and out of URLs. Use the scoped session provider; opting out removes saved keys.
- Reuse the shared vault seal operation and its full-flow lock. Do not release it between approval and write, or before a receipt/failure.
- Preserve visible costs, full accessible addresses, empty states and errors. Avoid clipping important content to make a narrow layout fit.
- Keep the existing deployed configuration, ABIs, routes and crypto functions as the source of truth.

## Attribution

Design guidance: Jakub Krehel's Better Interface, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0, adapted for this implementation. The supplied notices and licenses are retained in `docs/design-guidance-LICENSE.txt`.
