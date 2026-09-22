// Pure helpers shared by the content script and the unit tests.
(function (root) {
  const PALETTE_SIZE = 6;
  const STATUSES = ["merged", "ready", "waiting", "blocked", "draft", "unknown", "closed"];
  // Clockwise from 12 o'clock in the donut: what needs attention first, what is done last.
  const RING_ORDER = ["blocked", "waiting", "ready", "draft", "unknown", "merged", "closed"];
  // A 28px donut draws ~0.2px of arc per degree, so anything under ~10deg is a hairline.
  const MIN_SLICE_DEGREES = 10;

  function parseStackLabel(label) {
    const match = /position\s+(\d+)\s+of\s+(\d+)/i.exec(label || "");
    if (!match) return null;
    return { position: Number(match[1]), size: Number(match[2]) };
  }

  function parsePullHref(href) {
    const match = /^(?:https?:\/\/[^/]+)?\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(href || "");
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  }

  // "Filter by review: Changes requested" -> "changes_requested"
  function parseReviewLabel(label) {
    const match = /review:\s*(.+)$/i.exec(label || "");
    return match ? match[1].trim().toLowerCase().replace(/\s+/g, "_") : null;
  }

  // "Status checks: failure" -> "failure"
  function parseChecksLabel(label) {
    const match = /checks:\s*(.+)$/i.exec(label || "");
    return match ? match[1].trim().toLowerCase() : null;
  }

  // Returns the JSON object literal that starts at `start` (which must point at "{").
  function sliceJsonObject(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  // The PR page embeds `"stack":{"id":…,"pulls":[…]}` in its React payload.
  function extractStackFromHtml(html) {
    const marker = '"stack":{"id":';
    const index = (html || "").indexOf(marker);
    if (index < 0) return null;
    const json = sliceJsonObject(html, index + '"stack":'.length);
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  // `pulls` keeps GitHub's order: top of the stack first.
  function normalizeStack(raw) {
    if (!raw || typeof raw !== "object" || !Number.isFinite(raw.id)) return null;
    const pulls = (Array.isArray(raw.pulls) ? raw.pulls : [])
      .filter((p) => p && Number.isFinite(p.number))
      .map((p) => ({
        number: p.number,
        title: typeof p.title === "string" ? p.title : `#${p.number}`,
        state: typeof p.state === "string" ? p.state.toUpperCase() : "OPEN",
        url: typeof p.url === "string" ? p.url : null,
        headBranch: typeof p.headBranch === "string" ? p.headBranch : null,
      }));
    return {
      id: raw.id,
      number: Number.isFinite(raw.number) ? raw.number : null,
      size: Number.isFinite(raw.size) ? raw.size : pulls.length,
      position: Number.isFinite(raw.position) ? raw.position : null,
      baseBranch: typeof raw.baseBranch === "string" ? raw.baseBranch : null,
      pulls,
      pullNumbers: pulls.map((p) => p.number),
    };
  }

  // pull: { state } from stack data. row: what the list row shows, or null when the PR is not on the page.
  function pullStatus(pull, row) {
    if (pull.state === "MERGED") return "merged";
    if (pull.state === "CLOSED") return "closed";
    if (pull.state === "DRAFT" || (row && row.draft)) return "draft";
    if (!row) return "unknown";
    if (row.review === "changes_requested" || ["failure", "error"].includes(row.checks)) return "blocked";
    const reviewOk = row.review == null || row.review === "approved";
    const checksOk = row.checks == null || row.checks === "success";
    return reviewOk && checksOk ? "ready" : "waiting";
  }

  function summarizeStack(stack, rowsByNumber) {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const statuses = new Map();
    for (const pull of stack.pulls) {
      const status = pullStatus(pull, rowsByNumber.get(pull.number) || null);
      statuses.set(pull.number, status);
      counts[status]++;
    }
    return { counts, statuses, total: stack.pulls.length };
  }

  // rows: [{ number, stackId }] in page order (stackId null when unknown/not stacked).
  // stacks: Map stackId -> normalized stack. isFolded: stackId -> boolean.
  // Returns display items in the order they should appear, with every stack kept together:
  // a header, then its members top-first; open members missing from the page become ghosts.
  function buildDisplay(rows, stacks, isFolded) {
    const items = [];
    const emitted = new Set();
    let colorIndex = 0;

    rows.forEach((row, rowIndex) => {
      const stack = row.stackId == null ? null : stacks.get(row.stackId);
      if (!stack) {
        items.push({ kind: "row", rowIndex, stackId: null });
        return;
      }
      if (emitted.has(stack.id)) return;
      emitted.add(stack.id);

      const folded = Boolean(isFolded(stack.id));
      const color = colorIndex++ % PALETTE_SIZE;
      const group = [{ kind: "header", stackId: stack.id, colorIndex: color, folded }];
      const rowIndexByNumber = new Map();
      rows.forEach((r, i) => r.stackId === stack.id && rowIndexByNumber.set(r.number, i));

      for (const pull of stack.pulls) {
        if (rowIndexByNumber.has(pull.number)) {
          group.push({ kind: "row", rowIndex: rowIndexByNumber.get(pull.number), stackId: stack.id, pull });
          rowIndexByNumber.delete(pull.number);
        } else if (pull.state === "OPEN" || pull.state === "DRAFT") {
          group.push({ kind: "ghost", stackId: stack.id, pull });
        }
      }
      // Rows the stack data does not know about (stale data) still stay with their stack.
      for (const i of rowIndexByNumber.values()) group.push({ kind: "row", rowIndex: i, stackId: stack.id, pull: null });

      const visible = folded ? group.slice(0, 1) : group;
      group.forEach((item) => {
        item.colorIndex = color;
        item.hidden = !visible.includes(item);
      });
      visible.forEach((item, i) => {
        item.railUp = i > 0;
        item.railDown = i < visible.length - 1;
      });
      items.push(...group);
    });

    return items;
  }

  // ---- Header meta ------------------------------------------------------------

  // "#7130 · renovate[bot] opened 11 minutes ago", or the older "#479 opened 3 days ago by mira".
  const LOGIN = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\[bot\\])?";
  function parseRowAuthor(text) {
    const line = (text || "").replace(/\s+/g, " ");
    const verbs = "opened|merged|closed|reopened|created";
    // The lookahead stops `\\d+` from backtracking and reading "9" out of "#479 opened ...".
    const before = new RegExp(`#\\d+(?!\\d)\\s*·?\\s*(${LOGIN})\\s+(?:${verbs})\\b`, "i").exec(line);
    if (before) return before[1];
    const after = new RegExp(`\\b(?:${verbs})\\b[^·]*?\\bby\\s+(${LOGIN})`, "i").exec(line);
    return after ? after[1] : null;
  }

  // GitHub keeps app accounts under /apps, and the row spells them "renovate[bot]".
  function authorHref(login) {
    if (!login) return null;
    return login.endsWith("[bot]") ? `/apps/${login.slice(0, -"[bot]".length)}` : `/${login}`;
  }

  // logins of the members on the page, top of the stack first.
  function authorSummary(logins) {
    const present = (logins || []).filter(Boolean);
    if (!present.length) return null;
    const counts = new Map();
    for (const login of present) counts.set(login, (counts.get(login) || 0) + 1);
    // Most layers wins; a tie goes to the bottom-most author, whose stack it is.
    let login = present[present.length - 1];
    for (const [candidate, count] of counts) if (count > counts.get(login)) login = candidate;
    return { login, others: counts.size - 1 };
  }

  // Only members on the page carry a timestamp, so this is the span of what is visible.
  function ageSpan(times) {
    const stamps = (times || []).filter((t) => Number.isFinite(t));
    if (!stamps.length) return null;
    return { oldest: Math.min(...stamps), newest: Math.max(...stamps) };
  }

  function formatDuration(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${Math.max(minutes, 1)}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 60) return `${days}d`;
    const months = Math.floor(days / 30);
    if (months < 24) return `${months}mo`;
    return `${Math.floor(days / 365)}y`;
  }

  // Stacks merge bottom-up, so the only member you can act on is the lowest one still open.
  function nextAction(stack, statuses) {
    const pulls = stack.pulls || [];
    for (let i = pulls.length - 1; i >= 0; i--) {
      const pull = pulls[i];
      if (pull.state === "MERGED" || pull.state === "CLOSED") continue;
      return { pull, status: statuses?.get(pull.number) || "unknown" };
    }
    return null;
  }

  // Angles for the donut, clockwise from 12 o'clock. Slices thinner than `minDegrees` are pinned
  // to it and the rest share what is left, so a single blocked PR stays visible in a 20 PR stack.
  function donutSegments(counts, minDegrees = MIN_SLICE_DEGREES) {
    const present = RING_ORDER.filter((status) => counts[status] > 0);
    if (!present.length) return [];
    const min = Math.min(minDegrees, 360 / present.length);
    const pinned = new Set();
    let angles = new Map();
    for (;;) {
      const free = 360 - min * pinned.size;
      const freeTotal = present.reduce((sum, s) => (pinned.has(s) ? sum : sum + counts[s]), 0);
      if (!freeTotal) {
        angles = new Map(present.map((s) => [s, 360 / present.length]));
        break;
      }
      angles = new Map(present.map((s) => [s, pinned.has(s) ? min : (free * counts[s]) / freeTotal]));
      const tooThin = present.find((s) => !pinned.has(s) && angles.get(s) < min);
      if (!tooThin) break;
      pinned.add(tooThin);
    }
    let start = 0;
    return present.map((status) => {
      const angle = angles.get(status);
      const segment = { status, start, angle };
      start += angle;
      return segment;
    });
  }

  const api = {
    PALETTE_SIZE,
    STATUSES,
    RING_ORDER,
    MIN_SLICE_DEGREES,
    parseStackLabel,
    parsePullHref,
    parseReviewLabel,
    parseChecksLabel,
    extractStackFromHtml,
    normalizeStack,
    pullStatus,
    summarizeStack,
    buildDisplay,
    parseRowAuthor,
    authorHref,
    authorSummary,
    ageSpan,
    formatDuration,
    nextAction,
    donutSegments,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GitHubEasyStack = api;
})(globalThis);
