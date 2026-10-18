# MNEMO transaction revision validation

This revision addresses the two reopened findings. It preserves the accepted home story, styles, routes, contracts, addresses, ABIs, wallet configuration, dependency manifest/lockfile and cryptography. Only three app source files change, plus browser regressions, documentation, reviewer responses and the rebuilt export. This is a worker report, not an independent certification.

## Reproduction and fixes

The new regression scenarios first ran against the unchanged, previously committed `dist/` at 390×844 in Chromium. The result was **74/83 passing checks**, with nine failed assertions covering both reports. [Baseline report](revision-before.txt).

| Finding | Reproduced behavior | Correction and recheck |
| --- | --- | --- |
| High: `dbb472315a9490cb107e0c4f6e74f31d2015613caa9c15cbe45d5149fe672ca9` | After approval, held the accepted write receipt and returned JSON-RPC `-32603` from both configured RPC URLs. The hash disappeared, Seal enabled and forced resubmission sent another approval/write. | `web/src/context.tsx:81` adds a same-hook transaction guard. At `:102`, raw public-client receipts distinguish mined reverts from polling failures. Errors/timeouts keep the hash and pending state, retry after three seconds and leave `send()` unresolved, retaining the vault's approval/write lock. Each wait has a 60-second timeout; retrying it never broadcasts again. Mined repricing, cancellation and different replacement receipts resolve with their actual hash. Tests pass for both RPC errors, retained link, navigation, forced submits, same-hash recovery, timeout recovery and all three replacement outcomes. |
| Medium: `50b7e8b5d6244c4340bab2caf9ad7d6d885e2f926820f6291abb095411dbd518` | With the original write held, a later reply replaced proposals; confirming erased the new batch. Editing a submitted proposal and leaving another unselected also lost both. A newer Vault draft was emptied after confirming an older draft. | `web/src/Chat.tsx:127` snapshots the selected immutable proposal objects, then filters only those unchanged versions from current state. Later objects with identical text, edits and unselected proposals remain. `web/src/Home.tsx:105` clears only a draft still equal to its submitted text. Delayed-receipt tests pass on both surfaces. Tests decrypt the captured ciphertext to verify it contains only the original submitted content. |

Reviewer verdicts are also in root `.imd-responses.json`. No report was fixed solely from its description; both were reproduced before app changes.

## Actual checks

Commands ran from the repository root unless shown otherwise. Frontend installation used `npm ci --cache /tmp/mnemo-revision-npm-cache --no-audit --no-fund` in `web/`, with no manifest or lockfile changes.

| Command/check | Result |
| --- | --- |
| `npm --prefix web test` | Exit 0; all 9 existing unit tests pass. |
| `npm --prefix web run typecheck` | Exit 0. |
| `npm --prefix web run build` | Exit 0; typecheck, production bundle, ABI-hash verification and asset manifest generation pass. |
| `npm --prefix web run e2e` (Chromium) | Original 33/33 checks and the first expanded 89/89 regression/accessibility checks pass. |
| `node web/tests/regressions.mjs` (Chromium, final test scenarios) | Exit 0; 99/99 checks pass. [Report](revision-chromium.txt). |
| `MNEMO_BROWSER=webkit npm --prefix web run e2e` | Exit 0; original 33/33 checks and final 99/99 regression/accessibility checks pass. [Regression report](revision-webkit.txt). |
| `forge test --out test/scratch/forge-out --cache-path test/scratch/forge-cache` | Exit 0; 103 tests across six suites pass, none fail or skip. |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | Exit 0; 15/16 measured checks pass. The existing monospaced prose is the sole flag. [Measured checks](revision-taste-checks.json). |
| Exact-export verifier against a bounded local `/preview/` server | Exit 0; manifest and all 17 runtime files match this build. This verifies local serving, not publication. |

Browser commands used `PLAYWRIGHT_BROWSERS_PATH=/tmp/mnemo-revision-browsers`, `IMD_PLAYWRIGHT=/tmp/mnemo-browser/node_modules/playwright/index.mjs` and `MNEMO_AXE=/tmp/mnemo-browser/node_modules/@axe-core/playwright/dist/index.mjs`. No browser package or native library is submitted. WebKit needed temporary native libraries, a temporary browser-wrapper library path, `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`, `LD_LIBRARY_PATH=/tmp/mnemo-webkit-libs/usr/lib/x86_64-linux-gnu`, `__EGL_VENDOR_LIBRARY_FILENAMES=/tmp/mnemo-webkit-libs/usr/share/glvnd/egl_vendor.d/50_mesa.json`, `LIBGL_ALWAYS_SOFTWARE=1`, `EGL_PLATFORM=surfaceless` and `XDG_CACHE_HOME=/tmp/mnemo-revision-cache`. These settings enabled a real WebKit page and the complete tests after initial launcher failures; they are test-runtime settings, not site dependencies.

All transaction/model/RPC interactions use the existing EIP-6963 test wallet and controlled responses. Nothing is broadcast and no paid model is called. A receipt timeout is exercised by advancing browser time, without waiting a minute. Tests also retain coverage of chat state, credential scoping, quote races and keyboard skipping. All four routes have no horizontal scroll at 320, 390, 500 and 1440px in both browsers. Each engine's five automated WCAG A/AA scans reports zero violations.

## Better Interface review

Read the pinned workflow and all six domains' core principles. Applied them to the changed confirmation/pending states and checked the accepted design for regressions. The updated root `DESIGN.md` describes the final behavior without changing its tokens or layout.

| Domain | Coverage | Findings and limitations |
| --- | --- | --- |
| Accessibility | Checked native disabled Seal controls, labels, polite transaction status, accessible explorer link, keyboard navigation/skip and reduced motion. Five automated accessibility scans per browser pass. | No screen-reader, forced-colors or physical-device session. A passing scan does not establish full compliance. |
| Layout | Checked all routes at 320/390/500/1440px. Inspected current 390px first screen and receipt-error screenshots from both engines, plus the pending newer-proposal state. Status text wraps and its link remains visible. | No new layout finding. Native 200% zoom and RTL were not exercised. |
| Writing | Checked pending/error/success copy against what the app knows. Transport errors say “confirmation unavailable; still checking this transaction. Keep this tab open.” A receipt-backed revert, cancellation or different replacement is stated explicitly. | Fixed the high finding's false terminal-failure message. No provider/plan copy changed. |
| Typography | Reused existing type roles and wrapping; inspected the longer pending status at 390px. Probe passes the type-scale check. | Retained the accepted Spline Sans Mono prose: the probe flags 15 prose elements. The two existing families and three weights remain. Native text enlargement was not exercised. |
| Colors | No color changes. Probe passes measured solid text contrast (4.5:1, or 3:1 for large text); automated scans pass on affected routes. | Disabled text and every composite/hover pair were not independently measured. No new contrast ratios are claimed. |
| UI details | Walked ordinary pending, RPC-unavailable, timeout, confirmed, reverted, replacement, cancellation and retry states. Changed content stays editable while only the submitted content is cleaned up. Reduced-motion sample/capsule checks pass. | No new visual finding. No 10% Animations-panel replay, physical wallet, passkey creation or live mainnet transaction. |

Evidence: [current first phone screen](revision-home-390.webp), [Chromium receipt error with retained hash](revision-receipt-rpc-error-390.webp), [WebKit receipt error](revision-receipt-rpc-error-webkit-390.webp), [new proposals during the original seal](revision-new-proposals-pending-390.webp). These images use mocked wallet/RPC balances and transactions. The product and primary action remain on the first 390×844 screen. The probe confirms title, favicon, description, `og:title` and `og:image`.

## Export and publication

The complete rebuilt `dist/` has **18 files, 968,948 bytes**. Its main bundle is `assets/index-CwvyQM1y.js`. Index asset URLs remain relative, obsolete hashed bundles are removed, and the runtime ABI/asset manifest passes. No dependencies, package caches, archives, ignore files or protected project configuration were changed or added to the submission.

The packaging audit passed: 473 submission files measured 4,442,459 raw bytes and 1,530,390 bytes in an in-memory gzip bundle before this paragraph. The root reviewer-response metadata adds under 3 KiB; both totals remain below the 8,388,608-byte cap. All 17 runtime SHA-256 hashes match. No generated dependency/cache directory, dependency archive or submodule is included. `git diff --check` and the protected-path audit pass. No temporary verification archive was written into the repository.

Target remains **mnemo.site.identitymd.eth**. The authorized publication command `timeout 45s imd site publish dist --name mnemo` exited 1 immediately with **“not configured — run: imd pair --server <url>”**. No pairing or account/configuration change was attempted. `node web/scripts/verify-published.mjs https://mnemo.site.identitymd.eth.limo/` exited 1 with **“fetch failed”**. No successful live release, CID or hosted-byte confirmation is claimed. Hosting needs the existing IMD publication handoff/configured publisher; it does not need a different contract or site name.

Both reproduced findings are fixed and the local implementation, export and validation are complete. Live republish and hosted-byte confirmation remain unavailable for the runtime reasons above. The export is ready for the existing publishing handoff.
