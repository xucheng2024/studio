# Free cloud UAT

The first release recommends one no-upfront-cost path: GitHub Actions. Run `npm run uat:cloud-options` to show the same recommendation in a terminal.

## GitHub Actions

Choose GitHub Actions when you want the simplest setup and only need an occasional UAT run. The repository already supplies **Free cloud UAT** under Actions; select one flow and GitHub creates a fresh x64 Ubuntu runner, starts Docker-backed local Supabase, runs the browser verifier, and cleans up.

Why it is the default:

- no VM account, SSH access, patching, or idle host;
- x64 matches the project's preferred UAT architecture;
- every run starts clean and no production Supabase credentials are used.

The workflow reuses only immutable dependencies: npm download data, the Playwright Chromium binary, and a tar archive of the exact Supabase Docker images selected by the lockfile and workflow. Database volumes, Auth users, fixtures, screenshots, and reports are never cached. GitHub runs also skip Studio, Realtime, Storage, image proxy, mail testing, Edge Runtime, analytics, metadata, and pooler containers because the declared flows require only Postgres, Auth, API gateway, and PostgREST.

The first run for a new lockfile or workflow revision is intentionally cold and creates the browser and image caches. Later runs restore them. Changing the dependency lockfile, Supabase configuration, or workflow invalidates the relevant cache automatically; GitHub may also evict old caches under its repository cache limit.

Limits: standard runners are free without minute limits for public repositories. Private repositories consume the account's included minutes; GitHub Free currently includes a monthly allowance. A private-repository Ubuntu runner currently has 8 GB RAM and 14 GB SSD, so the workflow deliberately runs one flow at a time.

## What is not recommended

Paid hosted runners and cloud VMs are intentionally omitted from the first-release recommendation catalog. Oracle or another persistent runner should be introduced only after GitHub memory, storage, minutes, or failure-retention limits become a measured product constraint. GitHub's private-repository allowance must not be advertised as guaranteed, unlimited, or permanently available.
