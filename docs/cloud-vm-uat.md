# Cloud VM UAT

The first-release free entry point uses GitHub-hosted runners; see [Free cloud UAT](free-cloud-uat.md). This prepared-host workflow remains available for future capacity needs but is not part of the initial recommendation.

Studio can run its declared `uat.flows.json` browser flows on an existing Ubuntu 24.04 VM. Docker, the local Supabase stack, Next.js, Playwright, and the `uat-browser` runner must all run on that VM. Do not expose their ports publicly.

For the end-to-end release workflow that invokes this VM, see [Studio release gate](release-gate.md).

## Prepare the VM

Create or check out the repository as the dedicated `uatrunner` user at a fixed, reviewed commit. Copy the installed `uat-browser` skill to `/opt/uat-browser/skills/uat-browser`, or provide its directory with `--uat-browser-dir`.

From an approved administrator session, run:

```bash
sudo bash scripts/bootstrap-cloud-vm-uat.sh "$PWD" uatrunner
```

The bootstrap installs Docker, Compose, Git, Python, PostgreSQL client tools, Node.js 22, npm dependencies, and the Playwright Chromium runtime. The repository must already be owned by `uatrunner`; the script will not change repository ownership or retrieve credentials.

Start a new `uatrunner` login session after bootstrap so Docker group membership is active. Verify the host with:

```bash
python3 /opt/uat-browser/skills/uat-browser/deploy/cloud-vm/check_host.py
```

## Run one flow

```bash
npm run test:uat-cloud-vm -- \
  --flow pos-packages-local \
  --uat-browser-dir /opt/uat-browser/skills/uat-browser
```

The runner checks the host, starts local Supabase only when necessary, runs the declared flow, writes a compact report beneath `tmp/uat-browser`, and stops only the Supabase stack it started. A pre-existing local Supabase stack remains running.

Failures retain the environment by default. After inspecting the named report artifacts, clean it explicitly with:

```bash
npm run uat:environment -- cleanup
```

Use `--cleanup-on-failure` only when automatic failure cleanup is appropriate. Use `--keep-environment` to retain a successful environment. Neither option removes Docker volumes or resets the local database.

## Safety boundaries

- The automation does not create VMs, firewall rules, identities, or cloud credentials.
- All application and Supabase targets are checked as loopback-only by the existing Studio UAT safety helpers.
- Do not place secrets in `uat.flows.json`, command arguments, screenshots, or reports.
- Run only a fixed, reviewed commit and apply the cloud provider's approved shutdown and artifact-retention policies separately.
