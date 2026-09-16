const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

const stackOf = (id, pulls) => core.normalizeStack({ id, number: id + 1, size: pulls.length, baseBranch: "main", pulls });
const open = (number) => ({ number, title: `PR ${number}`, state: "OPEN" });
const merged = (number) => ({ number, title: `PR ${number}`, state: "MERGED" });

test("parseStackLabel reads position and size from the badge label", () => {
  assert.deepEqual(core.parseStackLabel("Pull request stack, position 3 of 10"), { position: 3, size: 10 });
  assert.equal(core.parseStackLabel("Open pull request"), null);
});

test("parsePullHref handles absolute and relative PR links", () => {
  assert.deepEqual(core.parsePullHref("https://github.com/infonl/zac/pull/7083"), { owner: "infonl", repo: "zac", number: 7083 });
  assert.deepEqual(core.parsePullHref("/a/b/pull/12/files"), { owner: "a", repo: "b", number: 12 });
  assert.equal(core.parsePullHref("https://github.com/a/b/issues/12"), null);
});

test("review and checks labels are parsed from the list row buttons", () => {
  assert.equal(core.parseReviewLabel("Filter by review: Changes requested"), "changes_requested");
  assert.equal(core.parseReviewLabel("Filter by review: Review required"), "review_required");
  assert.equal(core.parseChecksLabel("Status checks: failure"), "failure");
  assert.equal(core.parseChecksLabel(null), null);
});

test("extractStackFromHtml finds the embedded stack, ignoring braces inside strings", () => {
  const html =
    '<script>{"payload":{"other":1,"stack":{"id":634783,"number":6915,"size":10,' +
    '"pulls":[{"title":"fix {weird} \\"title\\"","number":6914,"state":"OPEN"},{"title":"x","number":6909,"state":"MERGED"}]},"after":true}}</script>';
  const stack = core.normalizeStack(core.extractStackFromHtml(html));
  assert.equal(stack.id, 634783);
  assert.deepEqual(stack.pullNumbers, [6914, 6909]);
  assert.equal(stack.pulls[0].title, 'fix {weird} "title"');
  assert.equal(core.extractStackFromHtml("<html></html>"), null);
});

test("normalizeStack rejects payloads without an id", () => {
  assert.equal(core.normalizeStack(null), null);
  assert.equal(core.normalizeStack({ pulls: [] }), null);
});

test("pullStatus classifies PRs using stack state and the row's review and checks", () => {
  assert.equal(core.pullStatus({ state: "MERGED" }, null), "merged");
  assert.equal(core.pullStatus({ state: "OPEN" }, null), "unknown");
  assert.equal(core.pullStatus({ state: "OPEN" }, { draft: true }), "draft");
  assert.equal(core.pullStatus({ state: "OPEN" }, { review: "changes_requested", checks: "success" }), "blocked");
  assert.equal(core.pullStatus({ state: "OPEN" }, { review: "approved", checks: "failure" }), "blocked");
  assert.equal(core.pullStatus({ state: "OPEN" }, { review: "review_required", checks: "success" }), "waiting");
  assert.equal(core.pullStatus({ state: "OPEN" }, { review: null, checks: "pending" }), "waiting");
  assert.equal(core.pullStatus({ state: "OPEN" }, { review: null, checks: "success" }), "ready");
});

test("summarizeStack counts statuses per PR", () => {
  const stack = stackOf(1, [open(4), open(3), merged(2), merged(1)]);
  const rows = new Map([[3, { review: "approved", checks: "success" }]]);
  const summary = core.summarizeStack(stack, rows);
  assert.equal(summary.counts.merged, 2);
  assert.equal(summary.counts.ready, 1);
  assert.equal(summary.counts.unknown, 1);
  assert.equal(summary.statuses.get(3), "ready");
});

test("buildDisplay pulls split stack members together under a header, top of stack first", () => {
  const stacks = new Map([[7, stackOf(7, [open(30), open(20), open(10)])]]);
  const rows = [
    { number: 10, stackId: 7 },
    { number: 99, stackId: null },
    { number: 30, stackId: 7 },
  ];
  const items = core.buildDisplay(rows, stacks, () => false);
  assert.deepEqual(
    items.map((i) => (i.kind === "row" ? `row${rows[i.rowIndex].number}` : i.kind === "ghost" ? `ghost${i.pull.number}` : i.kind)),
    ["header", "row30", "ghost20", "row10", "row99"],
  );
  assert.deepEqual(items.slice(0, 4).map((i) => [i.railUp, i.railDown]), [[false, true], [true, true], [true, true], [true, false]]);
});

test("buildDisplay does not add ghosts for merged members", () => {
  const stacks = new Map([[7, stackOf(7, [open(30), merged(20)])]]);
  const items = core.buildDisplay([{ number: 30, stackId: 7 }], stacks, () => false);
  assert.deepEqual(items.map((i) => i.kind), ["header", "row"]);
});

test("buildDisplay hides members of folded stacks but keeps the header", () => {
  const stacks = new Map([
    [1, stackOf(1, [open(2), open(1)])],
    [5, stackOf(5, [open(6), open(5)])],
  ]);
  const rows = [2, 1, 6, 5].map((number) => ({ number, stackId: number < 5 ? 1 : 5 }));
  const items = core.buildDisplay(rows, stacks, (id) => id === 1);
  assert.deepEqual(items.map((i) => [i.kind, i.hidden]), [
    ["header", false], ["row", true], ["row", true],
    ["header", false], ["row", false], ["row", false],
  ]);
  assert.equal(items[0].folded, true);
  assert.deepEqual([items[0].railUp, items[0].railDown], [false, false]);
  assert.notEqual(items[0].colorIndex, items[3].colorIndex);
});
