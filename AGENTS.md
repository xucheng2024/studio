<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Before writing Next.js code, use targeted search to locate and read only the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Python / Ruff Rules

- Do not run `ruff format .` automatically.
- Do not reformat unrelated existing files.
- Do not run repository-wide auto-fixes unless explicitly requested.
- Prefer Ruff checks on Python files modified in the current task.
- Only run `ruff check .` when repository-wide validation is actually necessary.
- Use `ruff format --check .` when repository-wide formatting validation is needed.
- Only run `ruff format` on Python files modified in the current task.
- Only run `ruff check --fix` on Python files modified in the current task.
- Preserve existing formatting in untouched legacy files.
- Keep functional changes and formatting-only changes separate.

# Repository Scope & Efficiency

- Narrow candidate files with the current diff, `rg`, or `rg --files` before reading file contents.
- Exclude `.next/`, `.vercel/`, `tmp/`, `node_modules/`, and `supabase/.temp/` from searches unless the task directly concerns generated output.
- Do not scan the entire repository unless the task cannot be scoped more narrowly.
- Read only relevant file sections instead of dumping large files.
- Prefer concise and bounded command output.
- Do not repeat successful checks unless affected code has changed.
- Reuse known project facts instead of rediscovering them.
- Prefer one analysis pass, one implementation pass, and one validation pass.
- Prefer the closest feature-specific `npm` test script over repository-wide checks.
- Run ESLint against modified files when possible; run `npm run lint` only when repository-wide validation is necessary.
- Run `npm run build` only for release validation, framework or configuration changes, or when narrower checks cannot verify the change.
- For Supabase changes, inspect only the relevant migration, referenced schema objects, and dependent application code; do not read the full migration history.
- Check `git status` before making changes and preserve unrelated existing modifications.
- Do not modify unrelated files.
- Stop when the requested task is sufficiently verified.
- Keep command output and final responses concise.

# UI / E2E Validation

- UI validation should be automated whenever possible.
- Do not require manual user validation for routine UI changes.
- Prefer existing Playwright E2E tests over interactive browser exploration.
- Run only E2E tests relevant to the changed pages, components, or flows.
- Default mobile validation to Chromium at `390x844` unless broader coverage is explicitly requested.
- Use automated assertions for visibility, overflow, clickability, navigation, forms, console errors, and failed network requests.
- Use interactive browser investigation only when automated E2E tests fail or visual inspection is genuinely required.
- When browser investigation is needed, inspect only the failing flow.
- Do not perform broad exploratory clicking across unrelated pages.
- Avoid repeated screenshot -> inspect -> edit loops.
- Take at most one final screenshot per changed page unless debugging requires more.
- Treat passing automated E2E tests as sufficient routine validation unless visual review is explicitly required.
- Run full multi-browser or full-site validation only when explicitly requested or when preparing a release.

# Code Review

- Start reviews from the current diff.
- Review directly affected code and perform impact analysis where relevant.
- Check callers, consumers, shared interfaces, schemas, APIs, configuration, and tests that may be affected by the change.
- Expand beyond the diff only when there is a concrete dependency or regression path to investigate.
- Do not perform broad repository-wide review unless there is evidence it is necessary.
- Prioritize correctness, regressions, security, authorization, data loss, compatibility, and operational risk.
- Pay extra attention to database migrations, API contracts, shared types, authentication, payments, webhooks, and environment-variable changes.
- Ignore style-only issues already covered by Ruff, formatters, or automated tests.
- Do not speculate about hypothetical problems without evidence from the changed code or its dependency path.
- Report only actionable findings, ordered by severity.
- Stop when the changed code and realistic impact paths have been sufficiently reviewed.

# Post-Change Review

- After implementation, perform one focused review of the current diff and realistic impact paths.
- Do not start an open-ended review/fix loop.
- If the review finds clear, actionable issues caused by the current change, fix them in one targeted pass.
- After that fix pass, run one final targeted validation.
- Do not perform another full review unless the final validation fails or the user explicitly requests it.
- Ignore speculative, style-only, or unrelated legacy issues during post-change review.
- Stop once the requested change is correct and sufficiently verified.

# Project UAT Routing

- For browser/UAT work, use the `$uat-browser` skill and read `uat.flows.json` before searching for test commands.
- Treat `uat.flows.json` as discovery only: inspect the selected verifier's target, writes, auth, and server lifecycle before execution.
- For APT-04 appointment paths, prefer `npm run test:local-uat`; it runs against Docker-backed local Supabase and cleans up its local Next server.
- Do not modify `uat.flows.json` during an ordinary UAT run. Sync it only when the task explicitly creates, updates, or maintains UAT routing.
- Do not run remote or data-writing UAT flows without explicit task authority. Never use a production fallback.
