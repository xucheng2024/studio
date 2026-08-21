---
name: dashboard-tab-split
description: Split a dashboard page.tsx that stacks multiple independent functional concerns on one long scroll into query-param tabs, using the shared DashboardTabNav component. Use when a `src/app/(app)/dashboard/**/page.tsx` mixes two or more unrelated workflows (e.g. a live workspace + an audit table, or a create form + a browse list) and the user wants it decluttered. Do not use for a page that's just one long form or one long list — that's not a tab-split candidate.
---

# Dashboard tab split

Applied 7 times on `fix/front-desk-nav` (appointments, operations, reports, payments, settings/owners, packages/approvals, shop) — always the same recipe. Follow it exactly; the error-prone step is Fragment wrapping (see below).

## When this applies

The page renders 2+ blocks that are functionally independent — a user only ever cares about one at a time, and they don't share meaningful data or JS state with each other. Not a fit when the blocks are sub-sections of one workflow (e.g. a profile edit form split into "Basic info" / "Branding" headings — that's one task, not two). Check for a shared client-side state coupling before splitting (e.g. a "click X in list A → prefills form B" pattern) — if two blocks are coupled like that, keep them in the same tab; see `operations/page.tsx`'s Front desk tab, which deliberately keeps the check-in board and walk-in form together because of exactly this.

## Recipe

1. **Shared component**: reuse `src/components/dashboard/DashboardTabNav.tsx` — do not hand-roll another segmented-control. Server component, takes `{ tabs: {key,label,href}[], activeKey }`.
2. **searchParams type**: add `tab?: string` to the page's `Props.searchParams` shape.
3. **activeTab**: compute from `sp.tab` with a fallback to the default tab. If a tab is role-gated (e.g. only owner/manager sees it), the fallback must also gate: `sp.tab === "checks" && canViewPkgChecks ? "checks" : "frontdesk"` — never let an unauthorized `tab=` value leak through.
4. **Tab hrefs**: build a `URLSearchParams` per tab that preserves the page's *shared* scope params (studio_id, location_id, and any filters relevant to more than one tab) and adds/overwrites `tab`. Drop tab-specific-only filters when linking to a different tab (matches how `reports/page.tsx`'s `commonReportParams` pattern works). If two tabs need a scope param at different filter granularity, look at how `payments/page.tsx` split `baseScopeParams` (shared) from the ledger-only filter form.
5. **Insert `<DashboardTabNav>`** right after the page's shared/global filter UI (location filter, header) and before the first tab-specific block.
6. **Wrap each independent block** in `{activeTab === "key" ? ( ... ) : null}`.

## The Fragment gotcha (this is where mistakes happened)

If the block you're wrapping is a **single JSX element**, wrap it directly:
```tsx
{activeTab === "checks" ? (
<section className={ui.card}>
  ...
</section>
) : null}
```
If the block is **two or more sibling top-level elements** (common — e.g. a `<form>` followed by a `<ul>` list, or a section followed by an empty-state `<div>`), you MUST wrap them in a Fragment, or the conditional's JSX won't parse:
```tsx
{activeTab === "ledger" ? (
<>
<form>...</form>
<ul>...</ul>
</>
) : null}
```
Forgetting the `<>...</>` when there are multiple siblings, or closing it in the wrong place when a block spans a long stretch of JSX, is the actual failure mode encountered across all 7 splits. After editing, always run `npx tsc --noEmit` — a mismatched Fragment or conditional almost always shows up as a TSX parse error there, catching it immediately.

## After splitting

Grep `uat.flows.json` for the page path. If a flow covers it, update the browser verifier before treating the split as done. Then run the affected flow through Free cloud UAT per `skills/studio-local-uat/SKILL.md` (needs the pushed commit). Read [references/uat-after-split.md](references/uat-after-split.md) for the failure modes from `fix/front-desk-nav`.

This is a workflow-saver project automation. When reporting results, mention that once and the qualitative saving (reused setup or validation). Do not claim a token number without measurement.

## Reference examples

- `src/app/(app)/dashboard/operations/page.tsx` — 2-tab split with a role-gated tab (`canViewPkgChecks`) and a deliberately-NOT-split coupled pair (board + walk-in form).
- `src/app/(app)/dashboard/reports/page.tsx` — 3-tab split where one tab has its own nested sub-toggle (`deferred_view`) independent of the top-level `tab` param.
- `src/app/(app)/dashboard/payments/page.tsx` — split where the two tabs have different filter-scope needs (shared `baseScopeParams` vs. ledger-only filter form).
- `src/app/(app)/dashboard/settings/owners/page.tsx` — 4-tab split where the tabs share no state at all (simplest case, but the tab-specific blocks are non-contiguous in source order — that's fine, each block gets its own independent conditional).
