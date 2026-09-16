const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("parseStackLabel reads position and size from the badge label", () => {
  assert.deepEqual(core.parseStackLabel("Pull request stack, position 3 of 10"), { position: 3, size: 10 });
  assert.equal(core.parseStackLabel("Open pull request"), null);
});

test("parsePullHref handles absolute and relative PR links", () => {
  assert.deepEqual(core.parsePullHref("https://github.com/infonl/zac/pull/7083"), { owner: "infonl", repo: "zac", number: 7083 });
  assert.deepEqual(core.parsePullHref("/a/b/pull/12/files"), { owner: "a", repo: "b", number: 12 });
  assert.equal(core.parsePullHref("https://github.com/a/b/issues/12"), null);
});

test("extractStackFromHtml finds the embedded stack, ignoring braces inside strings", () => {
  const html =
    '<script>{"payload":{"other":1,"stack":{"id":634783,"number":6915,"size":10,' +
    '"pulls":[{"title":"fix {weird} \\"title\\"","number":6914},{"title":"x","number":6909}]},"after":true}}</script>';
  const stack = core.extractStackFromHtml(html);
  assert.equal(stack.id, 634783);
  assert.deepEqual(core.normalizeStack(stack).pullNumbers, [6914, 6909]);
  assert.equal(core.extractStackFromHtml("<html></html>"), null);
});

test("normalizeStack rejects payloads without an id", () => {
  assert.equal(core.normalizeStack(null), null);
  assert.equal(core.normalizeStack({ pulls: [] }), null);
});

test("layoutLanes reuses a lane for stacks that do not overlap", () => {
  // Mirrors the screenshot: 3 loose PRs, a 3-stack, then two adjacent 10-stacks.
  const ids = [null, null, null, "A", "A", "A", "B", "B", "C", "C"];
  const { laneCount, rows } = core.layoutLanes(ids);
  assert.equal(laneCount, 1);
  assert.deepEqual(rows[0], []);
  assert.deepEqual(
    rows[3].map((s) => [s.lane, s.member, s.continuesUp, s.continuesDown]),
    [[0, true, false, true]],
  );
  assert.deepEqual(rows[5][0].continuesDown, false);
  assert.notEqual(rows[5][0].colorIndex, rows[6][0].colorIndex);
});

test("layoutLanes opens a second lane for interleaved stacks and marks pass-through rows", () => {
  const ids = ["A", "B", null, "A", "B"];
  const { laneCount, rows } = core.layoutLanes(ids);
  assert.equal(laneCount, 2);
  assert.deepEqual(rows[1].map((s) => [s.stackId, s.lane, s.member]), [["A", 0, false], ["B", 1, true]]);
  assert.deepEqual(rows[2].map((s) => s.member), [false, false]);
});
