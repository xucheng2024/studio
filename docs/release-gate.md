# Studio release gate

The `Studio release gate` GitHub Actions workflow releases one immutable commit from `origin/main` through isolated local UAT, audited remote preflight, a staged Vercel production candidate, browser smoke testing, and an approved production promotion.

The candidate is built with Vercel's Production environment but deployed with `--skip-domain`. It therefore uses production configuration without receiving production traffic. After approval, `vercel promote` assigns the production domains to that exact staged deployment without rebuilding it.

## Required infrastructure

1. Prepare an Ubuntu 24.04 VM with [`scripts/bootstrap-cloud-vm-uat.sh`](../scripts/bootstrap-cloud-vm-uat.sh).
2. Install `uat-browser` at `/opt/uat-browser/skills/uat-browser`, or set the repository variable `UAT_BROWSER_DIR`.
3. Install a Git checkout of the version-pinned `uat-infra` skill on the VM. Set `UAT_INFRA_DIR` to its skill directory and `UAT_INFRA_COMMIT` to its exact 40-character Git commit. The workflow verifies that pin, then runs its read-only `studio-uat` capacity and tool check before dependency installation.
4. Register the VM as a GitHub self-hosted runner with all four labels: `self-hosted`, `linux`, `x64`, and `studio-uat`.
5. Keep the runner dedicated to reviewed Studio release commits. The workflow accepts only a full 40-character SHA reachable from `origin/main`.

The Cloud VM runs flows sequentially because they share the local Docker daemon. Each flow owns its declared start/readiness/inspection/cleanup lifecycle. Add future databases and servers as flow-specific Compose modules; do not leave them as undeclared shared VM services. Successful flows clean up automatically. Failed flows retain their environment for diagnosis.

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
- The repository pins its release-only Vercel CLI under `tools/vercel-cli`. Its dependency tree is isolated from application dependencies, and the vulnerable transitive `tar` version from the upstream CLI package is overridden to a patched release.

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
