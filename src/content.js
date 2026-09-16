(() => {
  const core = globalThis.GitHubEasyStack;

  const LIST_SELECTOR = 'ul[data-listview-component="items-list"]';
  const TITLE_SELECTOR = 'a[data-testid="listitem-title-link"]';
  const BADGE_SELECTOR = 'button[aria-label^="Pull request stack"]';
  const LEADING_ICON_SELECTOR = '[class*="LeadingContent-module__container"] svg';
  const LANE_WIDTH = 12;
  const MAX_CONCURRENT_FETCHES = 3;
  const RETRY_FAILED_AFTER_MS = 60_000;

  // "owner/repo#number" -> { stack } | { failedAt }
  const cache = new Map();
  // "owner/repo#number" -> { pull, size }
  const pending = new Map();
  // "owner/repo|size" of stacks currently being fetched
  const inFlight = new Set();

  const keyOf = (pull) => `${pull.owner}/${pull.repo}#${pull.number}`.toLowerCase();

  function cachedStack(pull) {
    const entry = cache.get(keyOf(pull));
    return entry && entry.stack ? entry.stack : null;
  }

  function needsFetch(pull) {
    const entry = cache.get(keyOf(pull));
    if (!entry) return true;
    return !entry.stack && Date.now() - entry.failedAt > RETRY_FAILED_AFTER_MS;
  }

  async function fetchStack(pull) {
    const base = `/${pull.owner}/${pull.repo}/pull/${pull.number}`;
    // Same endpoint GitHub's own stack badge dialog uses (requires a signed-in session).
    try {
      const response = await fetch(`${base}/page_data/stack`, {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "GitHub-Verified-Fetch": "true",
        },
      });
      if (response.ok) {
        const stack = core.normalizeStack((await response.json())?.stack);
        if (stack) return stack;
      }
    } catch {
      // fall through to the PR page
    }
    const response = await fetch(base, { credentials: "same-origin", headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stack = core.normalizeStack(core.extractStackFromHtml(await response.text()));
    if (!stack) throw new Error("No stack data on PR page");
    return stack;
  }

  function pumpFetches() {
    for (const [key, { pull, size }] of pending) {
      // An earlier response may already have covered this PR.
      if (!needsFetch(pull)) {
        pending.delete(key);
        continue;
      }
      if (inFlight.size >= MAX_CONCURRENT_FETCHES) return;
      // One response covers a whole stack, so hold back PRs that may belong to a stack being fetched.
      const flightKey = `${pull.owner}/${pull.repo}|${size}`.toLowerCase();
      if (inFlight.has(flightKey)) continue;
      pending.delete(key);
      inFlight.add(flightKey);
      cache.set(key, { failedAt: Date.now() }); // placeholder so it is not queued twice
      fetchStack(pull)
        .then((stack) => {
          const numbers = new Set([...stack.pullNumbers, pull.number]);
          for (const number of numbers) cache.set(keyOf({ ...pull, number }), { stack });
        })
        .catch(() => cache.set(key, { failedAt: Date.now() }))
        .finally(() => {
          inFlight.delete(flightKey);
          scheduleUpdate();
          pumpFetches();
        });
    }
  }

  function readRow(li) {
    const pull = core.parsePullHref(li.querySelector(TITLE_SELECTOR)?.getAttribute("href"));
    const badge = core.parseStackLabel(li.querySelector(BADGE_SELECTOR)?.getAttribute("aria-label"));
    return { li, pull, badge };
  }

  function dotOffset(li) {
    const icon = li.querySelector(LEADING_ICON_SELECTOR);
    if (!icon) return 24;
    const iconRect = icon.getBoundingClientRect();
    return Math.round(iconRect.top + iconRect.height / 2 - li.getBoundingClientRect().top);
  }

  function clearList(list) {
    list.querySelectorAll(":scope > li > .ges-rail").forEach((rail) => rail.remove());
    list.querySelectorAll(":scope > li[data-ges-stack]").forEach((li) => {
      li.removeAttribute("data-ges-stack");
      li.removeAttribute("data-ges-hl");
    });
    list.removeAttribute("data-ges-lanes");
    list.style.removeProperty("--ges-gutter");
    list.style.removeProperty("--ges-base-pad");
  }

  function renderRail(li, segments, stacks) {
    let rail = li.querySelector(":scope > .ges-rail");
    if (!segments.length) {
      rail?.remove();
      li.removeAttribute("data-ges-stack");
      return;
    }
    const y = dotOffset(li);
    const signature = JSON.stringify([y, segments]);
    const member = segments.find((s) => s.member);
    if (member) li.setAttribute("data-ges-stack", String(member.stackId));
    else li.removeAttribute("data-ges-stack");
    if (rail && rail.dataset.signature === signature) return;

    if (!rail) {
      rail = document.createElement("div");
      rail.className = "ges-rail";
      rail.setAttribute("aria-hidden", "true");
      li.appendChild(rail);
    }
    rail.dataset.signature = signature;
    rail.replaceChildren();

    for (const segment of segments) {
      const left = 10 + segment.lane * LANE_WIDTH;
      const color = `ges-c${segment.colorIndex}`;
      const addLine = (top, bottom) => {
        const line = document.createElement("span");
        line.className = `ges-line ${color}${segment.member ? "" : " ges-pass"}`;
        line.dataset.stack = String(segment.stackId);
        line.style.left = `${left}px`;
        line.style.top = top;
        line.style.bottom = bottom;
        rail.appendChild(line);
      };
      if (!segment.member) {
        addLine("-1px", "0");
        continue;
      }
      if (segment.continuesUp) addLine("-1px", `calc(100% - ${y}px)`);
      if (segment.continuesDown) addLine(`${y}px`, "0");

      const dot = document.createElement("span");
      dot.className = `ges-dot ${color}`;
      dot.dataset.stack = String(segment.stackId);
      dot.style.left = `${left}px`;
      dot.style.top = `${y}px`;
      const stack = stacks.get(segment.stackId);
      if (stack?.number) dot.title = `Stack #${stack.number}`;
      rail.appendChild(dot);
    }
  }

  function updateList(list) {
    const rows = [...list.children].filter((el) => el.tagName === "LI").map(readRow);

    const stacksById = new Map();
    const stackIds = rows.map(({ pull, badge }) => {
      if (!pull || !badge) return null;
      const stack = cachedStack(pull);
      if (!stack) {
        if (needsFetch(pull)) pending.set(keyOf(pull), { pull, size: badge.size });
        return null;
      }
      stacksById.set(stack.id, stack);
      return stack.id;
    });
    pumpFetches();

    const layout = core.layoutLanes(stackIds);
    if (layout.laneCount === 0) {
      if (list.hasAttribute("data-ges-lanes")) clearList(list);
      return;
    }

    const gutter = `${8 + layout.laneCount * LANE_WIDTH}px`;
    if (!list.hasAttribute("data-ges-lanes") && rows[0]) {
      list.style.setProperty("--ges-base-pad", getComputedStyle(rows[0].li).paddingLeft);
    }
    if (list.getAttribute("data-ges-lanes") !== String(layout.laneCount)) {
      list.setAttribute("data-ges-lanes", String(layout.laneCount));
    }
    if (list.style.getPropertyValue("--ges-gutter") !== gutter) list.style.setProperty("--ges-gutter", gutter);

    rows.forEach(({ li }, index) => renderRail(li, layout.rows[index], stacksById));
  }

  function setHighlight(list, stackId) {
    list.querySelectorAll(":scope > li[data-ges-hl]").forEach((li) => li.removeAttribute("data-ges-hl"));
    list.querySelectorAll(".ges-active").forEach((el) => el.classList.remove("ges-active"));
    if (stackId == null) return;
    list.querySelectorAll(`:scope > li[data-ges-stack="${CSS.escape(stackId)}"]`).forEach((li) => li.setAttribute("data-ges-hl", ""));
    list.querySelectorAll(`.ges-rail [data-stack="${CSS.escape(stackId)}"]`).forEach((el) => el.classList.add("ges-active"));
  }

  function onPointerOver(event) {
    const list = event.target.closest?.(LIST_SELECTOR);
    if (!list) return;
    const li = event.target.closest(`${LIST_SELECTOR} > li`);
    const stackId = li?.getAttribute("data-ges-stack") ?? null;
    if (list.dataset.gesHover === (stackId ?? "")) return;
    list.dataset.gesHover = stackId ?? "";
    setHighlight(list, stackId);
  }

  function onPointerLeave(event) {
    const list = event.target;
    if (!(list instanceof Element) || !list.matches(LIST_SELECTOR)) return;
    list.dataset.gesHover = "";
    setHighlight(list, null);
  }

  let scheduled = false;
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      document.querySelectorAll(LIST_SELECTOR).forEach((list) => {
        updateList(list);
        resizeObserver.observe(list);
      });
    });
  }

  const isOwnNode = (node) => node instanceof Element && (node.classList.contains("ges-rail") || node.closest(".ges-rail"));

  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (isOwnNode(mutation.target)) continue;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (mutation.type === "childList" && nodes.length && nodes.every(isOwnNode)) continue;
      scheduleUpdate();
      return;
    }
  });

  const resizeObserver = new ResizeObserver(scheduleUpdate);

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "href"],
  });
  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("pointerleave", onPointerLeave, true);
  scheduleUpdate();
})();
