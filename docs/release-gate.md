# Studio release gate

The `Studio release gate` GitHub Actions workflow releases one immutable commit from `origin/main` through isolated local UAT, audited remote preflight, a staged Vercel production candidate, browser smoke testing, and an approved production promotion.

The candidate is built with Vercel's Production environment but deployed with `--skip-domain`. It therefore uses production configuration without receiving production traffic. After approval, `vercel promote` assigns the production domains to that exact staged deployment without rebuilding it.

## Required infrastructure

First release uses GitHub-hosted `ubuntu-24.04` for isolated Docker UAT (`scripts/run-github-hosted-uat.mjs --flow all-batched`). A self-hosted Cloud VM is optional later capacity, not required to run this gate.

The workflow accepts only a full 40-character SHA reachable from `origin/main`.

## GitHub Environments

Create these environments under repository Settings → Environments.

### `release-preflight`

Secrets:

- `RELEASE_SUPABASE_URL`
- `RELEASE_SUPABASE_SERVICE_ROLE_KEY`

Variables:

- `RELEASE_CRM01_STUDIO_ID`
- `RELEASE_POS_PKG_STUDIO_ID`

The selected preflight scripts only issue aggregate reads. The Supabase service-role credential is nevertheless privileged, so keep it only in this environment, restrict workflow editing, and rotate it according to the project's credential policy.

### `release-candidate`

Secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_AUTOMATION_BYPASS_SECRET` when Deployment Protection is enabled

The bypass secret is supplied only as an HTTP header to Playwright and is never included in the candidate URL or evidence.

### `production`

Secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Configure at least one required reviewer, enable “Prevent self-review”, disable administrator bypass where supported, and restrict deployment branches to `main`. Environment secrets are unavailable to the promotion job until its protection rules pass.

Creating an environment name from a workflow does not create protection rules. A repository administrator must configure these settings before the first release.

## Vercel project settings

- Keep Preview/Production Supabase projects and variables deliberately scoped.
- Turn off automatic assignment of production domains for unattended Git production deployments, so a push cannot bypass this gate.
- Enable Protection Bypass for Automation when deployment protection is active and copy its value only to the `release-candidate` GitHub Environment.
- The repository pins Vercel's native CLI under `tools/vercel-cli`, avoiding the Node CLI's large builder dependency tree. Release jobs install it with lifecycle scripts disabled, require the locked Linux x64 binary and exact native CLI version, and fail on high-or-higher `npm audit` findings. The native binary itself is an official prebuilt artifact, so its security posture is reviewed through the pinned version and npm lockfile integrity rather than JavaScript dependency audit output.

Vercel references:

- [Staged production deployments](https://vercel.com/docs/cli/deploying-from-cli#deploying-a-staged-production-build)
- [Promoting deployments](https://vercel.com/docs/cli/promote)
- [Protection bypass for automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)

## Run a release

1. Open Actions → `Studio release gate` → Run workflow.
2. Enter the full 40-character commit SHA from `origin/main`.
3. Review the Cloud VM report, remote preflight output, candidate URL, and smoke evidence.
4. Approve the waiting `production` environment job.

The production job re-inspects the staged URL before promotion and records the commit and candidate URL in the GitHub job summary.

## Failure handling

- Cloud VM UAT failure: inspect the retained VM evidence, then run `npm run uat:environment -- cleanup` when teardown is authorized.
- Remote preflight failure: correct the isolated production fixtures or application issue; it performs no writes.
- Candidate build/smoke failure: the staged deployment remains unpromoted. Inspect the Vercel deployment and local smoke artifact; delete it through the approved Vercel retention process if required.
- Promotion failure: production domains remain on the previous current deployment unless Vercel reports that promotion completed. Inspect promotion status before retrying.

This workflow does not apply remote database migrations, create cloud resources, or change GitHub/Vercel environment settings automatically.
