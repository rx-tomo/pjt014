E2E context budget: Playwright + MCP best practices

Goals
- Keep LLM context and artifacts small while preserving failure evidence.
- Speed up runs by reducing heavy captures (full-page PNGs, traces, videos, and parallel contexts).

Playwright config (applied)
- screenshot: only-on-failure — avoids success screenshots entirely.
- video: off — disables heavy video artifacts.
- trace: retain-on-failure — only keep traces when needed.
- viewport: 960x600, deviceScaleFactor: 1 — smaller failure screenshots.
- workers: 1 — caps concurrent browser contexts.

Manual screenshots (when absolutely needed)
- Prefer locator-level screenshots: await locator.screenshot({ type: 'jpeg', quality: 60 }).
- Avoid fullPage. If unavoidable, use clip to crop to the relevant area.
- Mask volatile UI (timestamps, counters) using expect(...).toHaveScreenshot({ mask: [locator] }).
- Attach by file path, not inline buffers (smaller impact on LLM context in some tools):
  await test.info().attach('snap', { path: filePath, contentType: 'image/jpeg' });

Logging first, image last
- Use test.step and console logs to describe intent and outcomes.
- Prefer textual assertions over image diffs unless explicitly doing visual regression.

Playwright MCP usage to save LLM context
- Prefer get-context over get-full-dom to avoid huge DOM payloads.
- Use validate-selectors to verify targets without screenshots.
- Use get-screenshot sparingly; when needed, capture element-level not full-page.
- Use execute-code to fetch small, structured values (innerText, attributes) instead of DOM dumps.

Environment toggles
- PW_SCREENSHOT: off | on | only-on-failure (default only-on-failure)
- PW_TRACE: off | retain-on-failure | on-first-retry (default retain-on-failure)
- PW_VIDEO: off | on | retain-on-failure (default off)
- PW_VIEWPORT_W/H: viewport size override
- PW_WORKERS: set >1 locally if you want parallel runs (uses more resources)

Suggested local run
- BASE_URL=http://127.0.0.1:3014 \
  PW_SCREENSHOT=only-on-failure PW_TRACE=retain-on-failure PW_VIDEO=off \
  PW_VIEWPORT_W=960 PW_VIEWPORT_H=600 PW_WORKERS=1 \
  npx playwright test

