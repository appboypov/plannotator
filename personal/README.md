# Personal Plannotator fork

This checkout maintains appboypov's changes on published Plannotator releases.
`origin` points only to `appboypov/plannotator`; `personal` is the default and
tracking branch. The release source is read-only and defined in
`updates/config/fork-config.ts`. No remote points to the original project.
GitHub Actions are disabled and inherited workflows are removed on every import.

## Development

Always read `/Users/codaveto/Work/skills/our-dev-conventions/SKILL.md` before
exploration, design, implementation, testing or review. Read each relevant
subject before touching that area and reapply it during review.

Keep personal behaviour in this directory, grouped by domain and concept.
Services own behaviour; APIs own process and storage I/O; commands parse and
invoke services; hooks own presentation state; components render it. Inject
dependencies through constructors. Put each primary type in its own file.
Upstream files should contain only small imports, adapters or calls. Preserve
upstream layout and behaviour outside the personal features. Avoid broad
renames or formatting changes. Test the personal behaviour at its boundaries.

`session-queue/` owns the cross-process queue. `updates/` owns release imports,
conflict todos, builds, installation and the version-menu action. `core/` holds
shared process I/O. `updates/config/upstream.json` records the imported release.

## Commands

Run from this checkout. Bun, Git, GitHub CLI and Linear CLI must be available.
GitHub CLI authenticates to your fork; Linear CLI must access the Brian team.

| Command | Result |
| --- | --- |
| `make check` | Latest published source release, installed build and update state |
| `make update` or `plannotator update` | Import, validate, build, push to your fork and install |
| `make status` | Current progress, retained checkout and conflict todo |
| `make resume` | Continue a retained update after resolving its conflict or build failure |
| `make test` | Personal process tests and typecheck |
| `make build` | Tested binary under `personal/build/` |
| `make install` | Build and atomically install to the configured local binary path |
| `make help` | Machine-readable command and exit-code reference |

The version-menu button calls the same update service through a local endpoint.
The job runs independently of the review window. Its log is
`.git/personal-update.log`; state is `.git/personal-update.sqlite`.
Use these commands for installation and updates. The inherited upstream
install scripts download upstream binaries and are not the fork's update path.

## Release imports

1. Commit current work on `personal`. The updater never stashes or discards edits.
2. The updater fetches `origin/personal` and advances only by fast-forward.
3. It fetches the latest published release by URL into `refs/upstream-releases/`.
4. It merges in `.git/personal-updates/<release>` on `updates/<release>`.
5. Inherited workflows are removed even if the release changes or adds them.
6. A clean merge is committed, tested and built. The updater pushes only the
   configured personal branch, advances the main checkout and installs the binary.
7. Conflicts leave the merge untouched and create a Brian todo with the exact
   prompt, checkout, branch and files. The installed binary stays unchanged.

The retained checkout is also kept on build or push failure. Resolve conflicts
there, stage resolutions, and run `make resume` from the main checkout. It repeats
validation before publishing and installing. Keep the todo open until this passes.
Never use `git reset`, `git restore`, `git checkout --`, `git stash`, or
`git merge --abort` to recover. Resolve files manually and retain the merge.
Never push or open a pull request against the original project. Enable Git rerere
locally to reuse previously resolved conflicts; review its resolutions before
staging them. The updater does not automatically stage rerere resolutions.
