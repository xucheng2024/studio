# UAT after a dashboard tab split

Grep `uat.flows.json` for the page path (for example `rg "appointments/page.tsx" uat.flows.json`). If a flow covers it, its browser verifier (`scripts/verify-*-browser-local.mjs`) likely asserts against content now hidden behind a tab, a section, or a collapsed disclosure.

On `fix/front-desk-nav`, `com01-commission-local`, `pkg01-package-ledger-local`, and `pos-packages-local` all failed on the first post-split UAT run because the page changed and the verifier did not.

## Failure modes

- **Content moved behind a non-default tab**: pass `?tab=<key>` directly in `page.goto(...)`, or click `page.getByRole("link", { name: "<Tab label>", exact: true })` then wait for the tab heading. Do not append `&tab=new` to a shared URL used by later navigations that need a different tab.
- **Content moved behind a non-tab section nav** (for example `?section=` on the client profile page): same fix, different query param. Grep the page for its param name; not every split uses `DashboardTabNav` / `?tab=`.
- **A page-level `<h1>` was dropped or made dynamic**: if the dynamic heading is the better design, drop `expectedHeading` and rely on `expectedTexts`.
- **A `<summary>`/`<details>` block is now collapsed**: if a shared `capture()` helper checks body text, expand collapsed details after navigation:
  `page.evaluate(() => document.querySelectorAll("details:not([open])").forEach(el => el.setAttribute("open", "")))`
- **A verifier string is case-sensitive but the UI uses CSS `uppercase`/`capitalize`**: match `innerText()`, not the JSX source.
- **A reload lands on the wrong tab**: replace `page.reload()` with `page.goto(...)` to the tab the assertion needs.

Run affected flows through Free cloud UAT after commit and push (`gh workflow run free-cloud-uat.yml -f flow=<flow-id> --ref <branch>`, then `gh run watch <run-id> --exit-status`). On failure, fetch the job log and grep `TimeoutError|AssertionError|Missing expected|waiting for`. Verifiers log the captured page body as JSON before throwing.
