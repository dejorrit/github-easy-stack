# GitHub Easy Stack

Chrome extension that groups [stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests) in GitHub's pull request lists.

- **Always grouped**: stack members are shown together under a stack header, even if other PRs sat between them. Open members that aren't on the current page (pagination, filters) show up as compact placeholder rows.
- **Progress**: the header shows a progress bar and counts: merged, ready, in progress, blocked, draft, not on this page.
- **Fold**: click a stack header to fold or unfold it. The toolbar popup has a *Fold stacks by default* setting.
- **Rail**: a colored line connects the members; hover a row to highlight its whole stack.

A PR counts as *ready* when it has no requested changes, no failing checks and isn't a draft. Review and check status is read from the list rows, so members not on the page are counted as *not on this page*.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Reload a GitHub pull request list.

## How it works

- Rows are found by GitHub's stack badge (`aria-label="Pull request stack, position X of Y"`). The badge doesn't say *which* stack a PR is in, and position/size alone can't tell apart two stacks of the same size.
- For each stack, the extension makes one same-origin request with your GitHub session. It first tries `/{owner}/{repo}/pull/{n}/page_data/stack` (the endpoint GitHub's badge popup uses), then falls back to the stack JSON embedded in the PR page. The response lists every PR in the stack with its title and state.
- Rows are regrouped with CSS `order` on the existing list items instead of moving GitHub's DOM nodes, so GitHub's React code keeps working. Keyboard navigation still follows GitHub's original order.
- Fold state per stack is kept in `chrome.storage.local`; the default lives in `chrome.storage.sync`.

## Tests

```sh
node --test test/
```

## Icons and store assets

`icons/` and the Chrome Web Store images in `store/` are rendered from `store/assets.html`. After editing it, regenerate the PNGs with installed Chrome:

```sh
npm install --no-save playwright-core
node store/render.mjs
```

Listing copy is in `store/listing.md`. When zipping the extension for upload, leave out `store/` and `test/`.
