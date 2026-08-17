# Free cloud UAT

The first release recommends one no-upfront-cost path: GitHub Actions. Run `npm run uat:cloud-options` to show the same recommendation in a terminal.

## GitHub Actions

Choose GitHub Actions when you want the simplest setup and do not need to maintain a server. The repository already supplies **Free cloud UAT** under Actions; select one flow, or select **all** to run the five isolated flows in parallel. Each job creates a fresh x64 Ubuntu runner, starts Docker-backed local Supabase, runs its browser verifier, and cleans up.

Select **all-batched** when GitHub Actions minutes matter more than elapsed time. It starts the disposable Supabase environment once, runs the five audited flows sequentially with isolated fixture identities, then cleans up once. It is slower to receive the complete result than **all**, but avoids four repeated service startups and migration replays.

Why it is the default:

- no VM account, SSH access, patching, or idle host;
- x64 matches the project's preferred UAT architecture;
- every run starts clean and no production Supabase credentials are used.

The workflow reuses only immutable dependencies: npm download data, the Playwright Chromium binary, and a tar archive of the exact Supabase Docker images selected by the lockfile and workflow. Database volumes, Auth users, fixtures, screenshots, and reports are never cached. GitHub runs also skip Studio, Realtime, Storage, image proxy, mail testing, Edge Runtime, analytics, metadata, and pooler containers because the declared flows require only Postgres, Auth, API gateway, and PostgREST.

The first run for a new lockfile or Supabase configuration revision is intentionally cold and creates the browser and image caches. Later runs restore them. Changing the dependency lockfile or Supabase configuration invalidates the relevant cache automatically; ordinary workflow scheduling changes do not. GitHub may still evict old caches under its repository cache limit.

For a few hours of active development, run only the flow affected by the latest change. A newer run for the same branch and flow automatically cancels its older in-progress run, so stale checks do not form a queue. Different flows can run concurrently; selecting **all** fans out to all five. Parallel runs reduce wall-clock time but consume roughly the same GitHub Actions minutes as running the flows one after another.

**Fast changed-path checks** run on pushes to `main`. They select only the affected non-Docker contract checks and add a workflow summary recommending the smallest cloud UAT flow when browser/database verification is warranted. They never start Docker or automatically spend minutes on a full UAT.

Limits: standard runners are free without minute limits for public repositories. Private repositories consume the account's included minutes; GitHub Free currently includes a monthly allowance. A private-repository Ubuntu runner currently has 8 GB RAM and 14 GB SSD. GitHub-hosted runners are intentionally disposable: no test environment remains alive between workflow runs. A persistent, interactive environment for several hours requires a self-hosted runner or cloud VM.

## What is not recommended

Paid hosted runners and cloud VMs are intentionally omitted from the first-release recommendation catalog. Oracle or another persistent runner should be introduced only after GitHub memory, storage, minutes, or failure-retention limits become a measured product constraint. GitHub's private-repository allowance must not be advertised as guaranteed, unlimited, or permanently available.
