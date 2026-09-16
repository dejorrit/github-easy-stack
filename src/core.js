// Pure helpers shared by the content script and the unit tests.
(function (root) {
  const PALETTE_SIZE = 6;

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

  function normalizeStack(raw) {
    if (!raw || typeof raw !== "object" || !Number.isFinite(raw.id)) return null;
    const pulls = Array.isArray(raw.pulls) ? raw.pulls : [];
    return {
      id: raw.id,
      number: Number.isFinite(raw.number) ? raw.number : null,
      size: Number.isFinite(raw.size) ? raw.size : null,
      pullNumbers: pulls.map((p) => p && p.number).filter(Number.isFinite),
    };
  }

  // stackIds: one entry per visible row, a stack id or null.
  // Assigns each stack a lane (column) so overlapping ranges never share one,
  // and describes what to draw on every row.
  function layoutLanes(stackIds) {
    const ranges = new Map();
    stackIds.forEach((id, row) => {
      if (id == null) return;
      const range = ranges.get(id);
      if (range) range.last = row;
      else ranges.set(id, { id, first: row, last: row });
    });

    const laneEnds = [];
    let colorIndex = 0;
    for (const range of ranges.values()) {
      let lane = laneEnds.findIndex((end) => end < range.first);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = range.last;
      range.lane = lane;
      range.colorIndex = colorIndex++ % PALETTE_SIZE;
    }

    const rows = stackIds.map((id, row) => {
      const segments = [];
      for (const range of ranges.values()) {
        if (row < range.first || row > range.last) continue;
        segments.push({
          stackId: range.id,
          lane: range.lane,
          colorIndex: range.colorIndex,
          member: id === range.id,
          continuesUp: row > range.first,
          continuesDown: row < range.last,
        });
      }
      return segments;
    });

    return { laneCount: laneEnds.length, stacks: ranges, rows };
  }

  const api = { parseStackLabel, parsePullHref, extractStackFromHtml, normalizeStack, layoutLanes, PALETTE_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GitHubEasyStack = api;
})(globalThis);
