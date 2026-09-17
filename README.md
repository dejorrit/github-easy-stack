# GitHub Easy Stack

Browser extension for Chrome and Firefox that groups [stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests) in GitHub's pull request lists.

- **Always grouped**: stack members are shown together under a stack header, even if other PRs sat between them. Open members that aren't on the current page (pagination, filters) show up as compact placeholder rows.
- **Progress**: the header shows a progress bar and counts: merged, ready, in progress, blocked, draft, not on this page.
- **Fold**: click a stack header to fold or unfold it. The toolbar popup has a *Fold stacks by default* setting.
- **Rail**: a colored line connects the members; hover a row to highlight its whole stack.

A PR counts as *ready* when it has no requested changes, no failing checks and isn't a draft. Review and check status is read from the list rows, so members not on the page are counted as *not on this page*.

## Install

**Chrome**

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Reload a GitHub pull request list.

**Firefox** (109 or later)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select this folder's `manifest.json`.
3. Reload a GitHub pull request list.

A temporary add-on is removed when Firefox restarts, so repeat step 2 after a restart.

## How it works

- Rows are found by GitHub's stack badge (`aria-label="Pull request stack, position X of Y"`). The badge doesn't say *which* stack a PR is in, and position/size alone can't tell apart two stacks of the same size.
- For each stack, the extension makes one same-origin request with your GitHub session. It first tries `/{owner}/{repo}/pull/{n}/page_data/stacks` (the endpoint GitHub's badge popup uses), then falls back to the stack JSON embedded in the PR page. The response lists every PR in the stack with its title and state.
- Rows are regrouped with CSS `order` on the existing list items instead of moving GitHub's DOM nodes, so GitHub's React code keeps working. Keyboard navigation still follows GitHub's original order.
- Fold state per stack is kept in `storage.local`; the default lives in `storage.sync`. The APIs are reached
  through `browser` when it exists and `chrome` otherwise, because Firefox's `chrome` alias is the
  callback flavour and doesn't return promises. `storage.sync` needs an add-on ID on Firefox, which is why
  the manifest carries a `browser_specific_settings.gecko.id`.

## Tests

```sh
node --test
```

## Icons and store assets

`icons/` and the Chrome Web Store images in `store/` are rendered from `store/assets.html`. After editing it, regenerate the PNGs with installed Chrome:

```sh
npm install --no-save playwright-core
node store/render.mjs
```

Listing copy is in `store/listing.md`.

## Releasing

Every push to `main` that touches `manifest.json`, `src/`, `popup/` or `icons/` runs `.github/workflows/bump-version.yml`. It runs the tests, bumps the patch version in `manifest.json`, and commits and tags the bump (`vX.Y.Z`) on `main`. For a minor or major bump, run the workflow by hand from the Actions tab and pick the part to bump.

The workflow pushes the version bump to `main` with `GITHUB_TOKEN`, so `main` must allow pushes from GitHub Actions.

To publish, pull the bump and build the zip:

```sh
git pull
scripts/build-zip.sh
```

Upload `dist/github-easy-stack-X.Y.Z.zip` in the [developer dashboard](https://chrome.google.com/webstore/devconsole) under **Package → Upload new package**, then submit it for review.
