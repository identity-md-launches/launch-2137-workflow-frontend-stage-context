# MNEMO validation and design review

The reopened transaction findings and this revision's current results are in [revision-validation.md](revision-validation.md). Both reports were reproduced and fixed. The record below describes the preceding accepted implementation; the revision record supersedes its test counts, export bytes and transaction-outcome coverage.

## Scope and outcome

The web app fixes the five reported bugs and implements the complete home story in the requested order. The existing contracts, addresses, ABI exports, hash routes, wallet connectors, transaction encoding and note/key encryption formats are preserved. The 40-line downloadable agent script has only three explanatory comments added to its existing 37 lines.

The static production export is `dist/` (18 files, 969,075 bytes at the final build). Assets are relative and the ABI-hash/build manifest step passed. Source, the existing unchanged package manifest/lockfile, export, README and root DESIGN.md are included. Local implementation and verification are complete. Live publication status is recorded separately below; a passing local export check is not a live release confirmation.

| Verification | Actual result |
| --- | --- |
| `npm --prefix web run typecheck` | Pass, exit 0 |
| `npm --prefix web test` | 9/9 existing unit tests pass |
| `npm --prefix web run build` | Pass, exit 0; Vite production export plus ABI and asset manifest verification |
| `npm --prefix web run e2e` with Chromium and optional axe module | 33/33 original checks plus 74/74 regression/accessibility checks pass |
| Same e2e command with `MNEMO_BROWSER=webkit` | 33/33 original checks plus 74/74 regression/accessibility checks pass |
| `forge test` | 103 tests across 6 suites pass; 0 failures, 0 skipped |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 15/16 checks pass; retained monospaced prose is the sole flag |
| Exact-export verifier against locally served `/preview/` | Manifest and all 17 hashed runtime files match; exit 0 |
| `git diff --check` | Pass |

The e2e runs used `IMD_PLAYWRIGHT=/tmp/mnemo-browser/node_modules/playwright/index.mjs` and `MNEMO_AXE=/tmp/mnemo-browser/node_modules/@axe-core/playwright/dist/index.mjs`. Browser packages, binary downloads and native support libraries were installed in temporary storage, outside the submission. WebKit required temporary native libraries and software EGL configuration. The provided browser connector initially failed to launch its missing Chrome channel; the checks and screenshots above use actual separately launched Playwright browsers, each in a bounded foreground script with its own server.

Evidence: [browser checks](browser-checks.txt), [raw taste results](taste-checks.json), [rendered metrics](visual-metrics.json), [390px first screen](home-390.webp), [500px first screen](home-500.webp), [1440px first screen](home-1440.webp), [full desktop story](home-1440-full.webp), [model section](models-390.webp), [agent section](agents-390.webp), [local unsealed example](sample-390.webp), [footer](footer-390.webp), [visible keyboard skip focus](keyboard-skip-390.webp). The pending-state images [Chat](chat-pending-390.webp) and [Vault](vault-pending-390.webp) use the test wallet/RPC fixtures; they are not real broadcasts.

## Explicit requirements

| Requirement | Status and evidence |
| --- | --- |
| Conversation, draft, proposed notes and memory-only key survive navigation | Met. Provider wraps App above routing. Tests navigate through every route, preserve edits/selection/key and receive a model response while away. |
| Open the vault inside Chat with one signature | Met. Memory panel opens in place; test records one signature and unchanged Chat hash. |
| Clear keys on provider/endpoint changes; remember by origin | Met. Synchronous session transitions clear the credential. Tests inspect outgoing headers, different origins, same-origin path changes, separate provider modes, explicit scoped restore, reload and opt-out deletion. Legacy unscoped credentials are removed. |
| Ignore stale trade quotes | Met. Every request is tagged, cleanup retires it and rendered quotes must match direction/amount. Tests resolve success/error requests out of order, reverse direction and clear the amount. |
| One seal per click until confirmation/failure | Met. Shared ref and state lock cover approval and write. Tests repeatedly submit forms in the same tick, hold both receipts, navigate to the other Seal surface, fail a receipt and retry successfully. |
| Skip without touching route hash | Met. Keyboard activation focuses/scrolls main on each of the four routes with its hash unchanged. |
| Hero and intentional capsule | Met. Existing headline/action retained. Finite dot gathering forms the outline, vault opening adds the orange seal, reduced motion is static. Actual settled outline and pending/open state inspected. |
| Open/Chat/Seal steps and small drawings | Met. Three responsive steps with a consistent SVG stroke and clear stamp/gas language. |
| Local ciphertext sample and Unseal sample | Met. Real encrypt/decrypt round trip using the existing crypto functions, marked Example, no wallet/RPC write. Reduced-motion reveal also tested. |
| Any-model section and free-key provider links | Met. Anthropic, OpenAI, compatible API and local server, with Groq/AI Studio links and usage-limit language. |
| On-chain/off-chain two-column table | Met. All five on-chain items and all three never-on-chain items, with context-provider/public-metadata clarification. |
| Agent wallet, llms.txt and copied 40-line script | Met. Existing Agents route, local docs, complete visible/scrollable code, exact copy and download. |
| Network totals and questions | Met. Existing RPC-backed totals retained; FAQ expanded and native disclosure markers restored. No synthetic live counts. |
| Large footer wordmark, nav, addresses/copy and no-backend/no-analytics line | Met. Full addresses come from the verified deployment manifest and remain readable/copyable at narrow widths. |
| Responsive 390, 500 and 1440px without horizontal scroll | Met, plus 320px. All four routes checked in both browser engines. |
| First phone screen, title/favicon/description/og:title/og:image | Met. Primary button bottom is 388.53px at 390×844. All five metadata checks pass and referenced local files are present. |
| Production export and build documentation | Met. Complete `dist/`, unchanged dependency lockfile, README install/preview/build/check steps and root DESIGN.md. |
| Republish same name and confirm new hosted bundle | See publication record below. Local checks do not claim this is complete. |

## Better Interface coverage

The pinned workflow and the core principles of all six domains were read before implementation and applied during construction. Source and rendered review were consolidated here.

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility | Checked native controls/labels, heading hierarchy, status/error regions, inert wallet overlay, forward/backward focus trap and return, keyboard skip, copy controls and disclosures. Five WCAG A/AA axe scans per engine have zero reported violations. Visible skip focus inspected; reduced-motion capsule and sample tested. | No screen-reader session, physical mobile wallet or forced-colors session. Automated scans are not a full compliance claim. |
| Layout | Checked every route at 320, 390, 500 and 1440px in Chromium and WebKit. Viewed final 390/500/1440 screenshots, intermediate sections and footer. No horizontal overflow, overlap or text clipping found. Real main action is in the first phone screen. | Native 200% browser zoom and RTL/pseudo-localization were not exercised. |
| Writing | Checked action labels, errors/recovery, costs, the local Example label, key persistence explanation and public/provider boundaries. Launch stamp is distinguished from the mutable current stamp and separate gas. | External provider plans/availability can change. No keys/accounts were obtained or paid providers exercised. |
| Typography | Reused the existing fonts/weights, subordinate mobile story headings, one token scale and untruncated values. FontFaceSet confirms Newsreader 600 and Spline Sans Mono 400/500 loaded. Long code wraps on home and remains copyable. | Monospaced prose is a deliberate existing identity choice; see the retained probe flag. Native text enlargement was not separately tested. |
| Colors | Probe passes resolved solid text contrast. Measured actual pairs: ink/paper 15.38:1, hint/paper 7.95:1, ink/orange action 5.68:1, paper/code ink 15.38:1. These are actual computed-color measurements recorded in visual-metrics.json. | Not every hover, alpha-backdrop or disabled composite was measured individually. Inactive controls are not claimed to meet active-text contrast. |
| UI details | Reviewed finite capsule and local reveal, pending/confirmed/failed/retry seal states, persistent status after proposals clear, native FAQ disclosure, button rest/hover/pressed/focus/disabled source styles and actual clipboard copying. | Motion was inspected at ordinary speed and reduced motion; no 10% Animations-panel replay. Coinbase passkey creation and physical wallet deep links were not exercised. |

## Findings and corrections

| Severity | Source | Finding, correction and recheck |
| --- | --- | --- |
| High | `web/src/main.tsx:27`, `web/src/chat-state.tsx:43`, `web/src/Chat.tsx:141` | Route-local Chat state was discarded and vault opening navigated away. Lifted the complete session and request completion into ChatProvider, and wired the memory panel to open in place. Cross-route state, asynchronous reply and one-signature checks pass in both engines. |
| High | `web/src/chat-state.tsx:54`, `web/src/chat-state.tsx:78`, `web/src/chat-model.ts:41` | Provider/endpoint changes retained a credential and storage had one unscoped key. Atomic setting changes clear it; saved keys use origin/provider slots, explicit restore and redirect rejection. Outgoing-header, path/origin, restore and opt-out tests pass. |
| High | `web/src/Trade.tsx:48` | A previous async quote could replace the newest result/minimum. Added monotonically tagged requests, cleanup guards and a direction/amount render match. Reversed-response, stale-error and direction tests pass. |
| High | `web/src/vault.tsx:132`, `web/src/Chat.tsx:125`, `web/src/Home.tsx:110` | Seal could be submitted repeatedly. Added a same-tick ref guard and a shared full-flow state lock through both receipts; buttons reflect it. Same-tick duplicate, navigation, failure and retry checks pass. |
| High | `web/src/App.tsx:36` | Skip changed the hash and could select the home route. Prevented link navigation, then focused and scrolled the current main. Keyboard tests pass for all routes. |
| Medium | `web/src/Chat.tsx:138`, `web/src/context.tsx:100` | Chat's success status disappeared when proposals cleared; a reverted receipt could show only “unknown reason.” Kept a stable transaction region outside the list and added a plain retry instruction for that fallback. Failure/retry/confirmation checks pass. |
| Medium | `web/src/ConnectSheet.tsx:44` | Wallet-modal focus could escape at the ends and returned only to the header button. Added Tab/Shift+Tab wrapping and return to the actual trigger. Both keyboard-direction checks and Escape focus return pass. |
| Medium | `web/src/styles.css:460` | Flex summary styling hid native disclosure markers. Restored native list-item markers and a 44px target. Screenshot/source review and FAQ interaction pass. |
| Low | `web/src/styles.css:695`, `web/src/Story.tsx:76` | Mobile story headings initially competed with the preserved hero and a short model description triggered the eyebrow heuristic. Reused the subordinate heading token on phones and clarified the compatible chat format. Final probe reports no eyebrows or scale failure. |

The sole retained taste flag is `type-faces`: 14 pieces of monospaced prose. This was already the product's established typography (`web/src/styles.css:1`, `:48`), retained consistently across old and new sections; it is not a claim that the probe passed 16/16. The exact existing seven-word headline is also retained because the brief explicitly says “Hero as today,” overriding the background six-word preference. There are two font families and three supplied weights; no extra font was added.

The free-key references were checked against [Groq's official free-plan limits](https://console.groq.com/docs/rate-limits), [Groq's OpenAI-compatible API](https://console.groq.com/docs/openai), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and [Gemini compatibility documentation](https://ai.google.dev/gemini-api/docs/openai). No numerical quota or free access guarantee is embedded in the app.

## Integrity and packaging

No protected configuration, manifest/lockfile, contract source, ABI, deployment/network configuration, `.git/`, `.github/` or `.env` file was changed. No ignore file was changed, no submodule exists, and dependency/cache directories remain excluded at every nesting level. The rebuilt export removes obsolete hashed bundles and includes all required runtime assets; there is no vendored registry, dependency tarball or source-map archive.

The measured current submission file set is below the 8,388,608-byte limit even before compression. Final file/byte totals and any release response are recorded below.

## Publication record

Target: `mnemo.site.identitymd.eth`, the existing name. An exact-byte hosted verification utility is included at `web/scripts/verify-published.mjs`.

The public ENS gateway check made during local review failed with a TLS internal alert / `fetch failed`, so it did not confirm either old or new site bytes. The same verifier passed against the complete production export served at a local `/preview/` subpath, including every manifest asset. No hosted success is inferred from that local result.


Publication attempt: `timeout 45s imd site publish dist --name mnemo` exited 1 immediately. The publisher answered **“not configured — run: imd pair --server <url>”**. No pairing, account setup, alternative site name or on-chain action was attempted. This is a runtime publishing limitation, not missing requester input. No new CID or successful live release can be claimed.

**Completion:** the local web implementation, production export, tests, responsive/design review and documentation are complete. The requested live republish and confirmation remain incomplete because the publisher is not configured and the ENS gateway check failed. The deliverable is ready for the existing hosting handoff; nothing is fabricated to stand in for a publication result.

Final packaging check: 449 submitted files; 3,727,081 raw bytes; 877,635 bytes in the verification gzip bundle (both below 8,388,608). The compressed bundle is temporary and is not part of the submission. Documentation added after this measurement is under 1 KiB. All 17 runtime SHA-256 hashes match, the downloaded and displayed agent script is complete at 40 lines, and no dependency/cache/archive/submodule is included.

The artifact-output directory is excluded by the submission environment, so the complete review, measurements, test reports and screenshots are also included in `docs/review/` for delivery with the Git source. No ignore rule was changed.

Final Git delivery after including the review evidence: 464 files, 4,305,596 bytes before this final paragraph; comfortably below the 8,388,608-byte cap.
