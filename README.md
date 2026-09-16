# GitHub Easy Stack

Chrome extension that draws a colored line down the left side of GitHub's pull request list, connecting PRs that belong to the same [stack](https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests). Hover a row to highlight the whole stack.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Reload a GitHub pull request list.

## How it works

- Rows are found by GitHub's stack badge (`aria-label="Pull request stack, position X of Y"`). The badge doesn't say *which* stack a PR is in, and position/size alone can't tell apart two stacks of the same size.
- For each stack, the extension makes one same-origin request with your GitHub session. It first tries `/{owner}/{repo}/pull/{n}/page_data/stack` (the endpoint GitHub's badge popup uses), then falls back to the stack JSON embedded in the PR page. The response lists every PR in the stack, so later rows from the same stack need no request of their own.
- Stacks get lanes like a git graph. A stack whose rows are split up by other PRs keeps a faded line through the rows in between.

## Tests

```sh
node --test test/
```
