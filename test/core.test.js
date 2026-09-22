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

test("normalizeStack keeps the head branch and position the payload gives for free", () => {
  const stack = core.normalizeStack({
    id: 1,
    size: 2,
    position: 2,
    baseBranch: "main",
    pulls: [{ number: 9, title: "t", state: "OPEN", headBranch: "feature/top" }, { number: 8, title: "t", state: "MERGED" }],
  });
  assert.equal(stack.position, 2);
  assert.equal(stack.pulls[0].headBranch, "feature/top");
  assert.equal(stack.pulls[1].headBranch, null);
});

test("parseRowAuthor reads the login out of a row's metadata line", () => {
  assert.equal(core.parseRowAuthor("#7130 · renovate[bot] opened 11 minutes ago"), "renovate[bot]");
  assert.equal(core.parseRowAuthor("#7108 · dejorrit opened 4 days ago · Approved"), "dejorrit");
  assert.equal(core.parseRowAuthor("#479 opened 3 days ago by mira"), "mira");
  assert.equal(core.parseRowAuthor("#7126 · xiduzo merged 2 hours ago"), "xiduzo");
  assert.equal(core.parseRowAuthor("Fix #12 opened door handling"), null);
  assert.equal(core.parseRowAuthor(""), null);
});

test("authorSummary names the busiest author and counts the rest", () => {
  assert.deepEqual(core.authorSummary(["mira"]), { login: "mira", others: 0 });
  assert.deepEqual(core.authorSummary(["mira", "jo", "mira"]), { login: "mira", others: 1 });
  // logins arrive top of the stack first, so a tie goes to the last one: the bottom layer.
  assert.deepEqual(core.authorSummary(["mira", "jo"]), { login: "jo", others: 1 });
  assert.equal(core.authorSummary([null, undefined]), null);
  assert.equal(core.authorSummary([]), null);
});

test("ageSpan spans the members that are on the page", () => {
  assert.deepEqual(core.ageSpan([300, 100, 200]), { oldest: 100, newest: 300 });
  assert.deepEqual(core.ageSpan([100, null, NaN]), { oldest: 100, newest: 100 });
  assert.equal(core.ageSpan([null]), null);
});

test("formatDuration stays short and never rounds up to a lie", () => {
  assert.equal(core.formatDuration(5_000), "1m");
  assert.equal(core.formatDuration(59 * 60_000), "59m");
  assert.equal(core.formatDuration(13 * 3600_000), "13h");
  assert.equal(core.formatDuration(47 * 3600_000), "1d");
  assert.equal(core.formatDuration(11 * 86400_000), "11d");
  assert.equal(core.formatDuration(90 * 86400_000), "3mo");
  assert.equal(core.formatDuration(800 * 86400_000), "2y");
});

test("nextAction points at the lowest member that has not merged", () => {
  const stack = stackOf(1, [open(4), open(3), merged(2), merged(1)]);
  const statuses = new Map([[3, "blocked"]]);
  assert.deepEqual(core.nextAction(stack, statuses), { pull: stack.pulls[1], status: "blocked" });
  assert.equal(core.nextAction(stack, new Map()).status, "unknown");
  assert.equal(core.nextAction(stackOf(2, [merged(2), merged(1)]), new Map()), null);
});

test("donutSegments keeps a thin slice visible without leaving a gap in the ring", () => {
  const counts = (partial) => ({ ...Object.fromEntries(core.STATUSES.map((s) => [s, 0])), ...partial });
  assert.deepEqual(core.donutSegments(counts({})), []);
  const half = core.donutSegments(counts({ merged: 1, ready: 1 }));
  assert.deepEqual(half.map((s) => [s.status, s.start, s.angle]), [["ready", 0, 180], ["merged", 180, 180]]);

  const thin = core.donutSegments(counts({ merged: 19, blocked: 1 }), 40);
  // blocked leads, at 12 o'clock, and is pinned to the minimum it was thinner than.
  assert.deepEqual(thin.map((s) => s.status), ["blocked", "merged"]);
  assert.equal(thin[0].angle, 40);
  assert.equal(thin[0].angle + thin[1].angle, 360);

  const many = core.donutSegments(counts({ merged: 40, ready: 1, waiting: 1, blocked: 1, draft: 1, unknown: 1, closed: 1 }));
  assert.equal(Math.round(many.reduce((sum, s) => sum + s.angle, 0)), 360);
  assert.ok(many.every((s) => s.angle >= core.MIN_SLICE_DEGREES - 1e-9));
  assert.deepEqual(many.map((s) => s.status), core.RING_ORDER);
});
