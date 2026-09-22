(() => {
  const core = globalThis.GitHubEasyStack;

  const LIST_SELECTOR = 'ul[data-listview-component="items-list"]';
  const TITLE_SELECTOR = 'a[data-testid="listitem-title-link"]';
  const BADGE_SELECTOR = 'button[aria-label^="Pull request stack"]';
  const REVIEW_SELECTOR = '[data-testid="review-decision-icon"] button[aria-label]';
  const CHECKS_SELECTOR = 'button[data-testid="checks-status-badge-button"]';
  const DRAFT_SELECTOR = 'svg[aria-label="Draft pull request"], svg.octicon-git-pull-request-draft';
  const TIME_SELECTOR = "relative-time[datetime]";
  const LEADING_ICON_SELECTOR = '[class*="LeadingContent-module__container"] svg';
  const MAX_CONCURRENT_FETCHES = 3;
  const SVG_NS = "http://www.w3.org/2000/svg";
  // Outer 22px, 5px ring: the hole stays 12px so the shape still reads as a donut.
  const DONUT_SIZE = 22;
  const DONUT_RADIUS = 8.5;
  const DONUT_STROKE = 5;
  const HAS_POPOVER = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;
  // Drawn as presentation attributes so the ring survives even if the stylesheet does not load;
  // content.css overrides the stroke with GitHub's own theme variable when it does.
  const STATUS_COLORS = {
    merged: "#8957e5",
    ready: "#238636",
    waiting: "#9e6a03",
    blocked: "#da3633",
    draft: "#656c76",
    unknown: "#3d444d",
    closed: "#656c76",
  };
  const RETRY_FAILED_AFTER_MS = 60_000;

  const STATUS_LABELS = {
    merged: "merged",
    ready: "ready",
    waiting: "in progress",
    blocked: "blocked",
    draft: "draft",
    unknown: "not on this page",
    closed: "closed",
  };

  const ICONS = {
    chevron: "M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z",
    stack:
      "M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.251 1.251 0 0 1 0-2.162ZM8.125 1.69a.248.248 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.248.248 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z",
    pull: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  };

  // ---- Settings -------------------------------------------------------------

  // Firefox exposes the promise-based APIs as `browser`; `chrome` there is the callback flavour.
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const extensionStorage = extensionApi?.storage;
  const settings = { foldByDefault: false, foldOverrides: {} };
  let settingsLoaded = !extensionStorage;

  function loadSettings() {
    if (!extensionStorage) return;
    try {
      Promise.all([
        extensionStorage.sync.get({ foldByDefault: false }),
        extensionStorage.local.get({ foldOverrides: {} }),
      ])
        .then(([sync, local]) => {
          settings.foldByDefault = Boolean(sync.foldByDefault);
          settings.foldOverrides = local.foldOverrides || {};
        })
        .finally(() => {
          settingsLoaded = true;
          scheduleUpdate();
        });
      extensionStorage.onChanged.addListener((changes) => {
        if (changes.foldByDefault) settings.foldByDefault = Boolean(changes.foldByDefault.newValue);
        if (changes.foldOverrides) settings.foldOverrides = changes.foldOverrides.newValue || {};
        scheduleUpdate();
      });
    } catch {
      settingsLoaded = true;
    }
  }

  function isFolded(stackId) {
    const overrides = settings.foldOverrides;
    return Object.hasOwn(overrides, stackId) ? overrides[stackId] : settings.foldByDefault;
  }

  function toggleFold(stackId) {
    const folded = !isFolded(stackId);
    const overrides = { ...settings.foldOverrides };
    if (folded === settings.foldByDefault) delete overrides[stackId];
    else overrides[stackId] = folded;
    settings.foldOverrides = overrides;
    try {
      extensionStorage?.local.set({ foldOverrides: overrides });
    } catch {
      // extension was reloaded; keep the in-page state
    }
    scheduleUpdate();
  }

  // ---- Stack data -------------------------------------------------------------

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
      const response = await fetch(`${base}/page_data/stacks`, {
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

  // ---- Rendering --------------------------------------------------------------

  function svgIcon(path, className) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", className);
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // The row's metadata line reads "#7130 · renovate[bot] opened 11 minutes ago". GitHub has renamed
  // the elements around it before, so walk out from the timestamp and fall back to the author filter link.
  function readAuthor(li, time) {
    for (let scope = time?.parentElement, depth = 0; scope && depth < 3; scope = scope.parentElement, depth++) {
      const login = core.parseRowAuthor(scope.textContent);
      if (login) return login;
    }
    const href = li.querySelector('a[href*="author%3A"], a[href*="author:"]')?.getAttribute("href");
    const match = /author(?:%3A|:)(?:app(?:%2F|\/))?([^&+\s"]+)/i.exec(href || "");
    return match ? decodeURIComponent(match[1]) : null;
  }

  function readRow(li) {
    const pull = core.parsePullHref(li.querySelector(TITLE_SELECTOR)?.getAttribute("href"));
    const badge = core.parseStackLabel(li.querySelector(BADGE_SELECTOR)?.getAttribute("aria-label"));
    const time = li.querySelector(TIME_SELECTOR);
    return {
      li,
      pull,
      badge,
      review: core.parseReviewLabel(li.querySelector(REVIEW_SELECTOR)?.getAttribute("aria-label")),
      checks: core.parseChecksLabel(li.querySelector(CHECKS_SELECTOR)?.getAttribute("aria-label")),
      draft: Boolean(li.querySelector(DRAFT_SELECTOR)),
      author: readAuthor(li, time),
      createdAt: Date.parse(time?.getAttribute("datetime") || "") || null,
    };
  }

  function dotOffset(item, node) {
    if (item.kind !== "row") return "50%";
    const icon = node.querySelector(LEADING_ICON_SELECTOR);
    if (!icon) return "24px";
    const iconRect = icon.getBoundingClientRect();
    return `${Math.round(iconRect.top + iconRect.height / 2 - node.getBoundingClientRect().top)}px`;
  }

  function renderRail(node, item) {
    let rail = node.querySelector(":scope > .ges-rail");
    const y = dotOffset(item, node);
    const signature = JSON.stringify([y, item.kind, item.colorIndex, item.railUp, item.railDown, item.folded]);
    if (rail && rail.dataset.signature === signature) return;
    if (!rail) {
      rail = el("div", "ges-rail");
      rail.setAttribute("aria-hidden", "true");
      node.appendChild(rail);
    }
    rail.dataset.signature = signature;
    rail.replaceChildren();

    const color = `ges-c${item.colorIndex}`;
    const addPart = (className, styles) => {
      const part = el("span", `${className} ${color}`);
      part.dataset.stack = String(item.stackId);
      Object.assign(part.style, styles);
      rail.appendChild(part);
    };
    if (item.railUp) addPart("ges-line", { top: "-1px", bottom: `calc(100% - ${y})` });
    if (item.railDown) addPart("ges-line", { top: y, bottom: "-1px" });
    addPart(`ges-dot ges-dot-${item.kind}${item.folded ? " ges-dot-folded" : ""}`, { top: y });
  }

  function syntheticNode(list, key, className) {
    let node = list.querySelector(`:scope > li[data-ges-key="${CSS.escape(key)}"]`);
    if (!node) {
      node = el("li", `ges-synthetic ${className}`);
      node.setAttribute("data-ges-synthetic", "");
      node.setAttribute("data-ges-key", key);
      list.appendChild(node);
    }
    return node;
  }

  function renderBody(node, signature, build) {
    let body = node.querySelector(":scope > .ges-body");
    if (body && body.dataset.signature === signature) return;
    if (!body) {
      body = el("div", "ges-body");
      node.prepend(body);
    }
    body.dataset.signature = signature;
    body.replaceChildren(...build());
  }

  function renderDonut(counts) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${DONUT_SIZE} ${DONUT_SIZE}`);
    svg.setAttribute("width", String(DONUT_SIZE));
    svg.setAttribute("height", String(DONUT_SIZE));
    svg.setAttribute("aria-hidden", "true");
    const center = DONUT_SIZE / 2;
    const circumference = 2 * Math.PI * DONUT_RADIUS;
    for (const segment of core.donutSegments(counts)) {
      const arc = document.createElementNS(SVG_NS, "circle");
      arc.setAttribute("class", `ges-arc ges-s-${segment.status}`);
      arc.setAttribute("cx", String(center));
      arc.setAttribute("cy", String(center));
      arc.setAttribute("r", String(DONUT_RADIUS));
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", STATUS_COLORS[segment.status]);
      arc.setAttribute("stroke-width", String(DONUT_STROKE));
      const length = (segment.angle / 360) * circumference;
      arc.setAttribute("stroke-dasharray", `${length} ${circumference - length}`);
      arc.setAttribute("stroke-dashoffset", String((-segment.start / 360) * circumference));
      arc.setAttribute("transform", `rotate(-90 ${center} ${center})`); // 0 degrees at 12 o'clock
      svg.appendChild(arc);
    }
    return svg;
  }

  // A popover with no positioning lands in the middle of the viewport, and CSS anchor positioning
  // is Chrome-only for now, so place it under the donut by hand.
  function positionLegend(legend, anchor) {
    const rect = anchor.getBoundingClientRect();
    // Inline, because the UA sheet centres a popover with `inset: 0; margin: auto`.
    legend.style.position = "fixed";
    legend.style.inset = "auto";
    legend.style.margin = "0";
    const width = legend.offsetWidth || 180;
    const height = legend.offsetHeight;
    let top = rect.bottom + 6;
    if (height && top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    legend.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    legend.style.top = `${top}px`;
  }

  function metaItem(text, title) {
    const item = el("span", "ges-meta-item", text);
    if (title) item.title = title;
    return item;
  }

  // Order matters: the line is one row tall with overflow hidden, so whatever wraps is dropped,
  // and the next action - the only thing here you can act on - is first in line to survive.
  function metaLine(meta) {
    const line = el("div", "ges-meta");
    if (meta.next) {
      const item = el("span", "ges-meta-item");
      const link = el("a", "ges-link", `#${meta.next.number}`);
      if (meta.next.url) link.href = meta.next.url;
      item.append("next: ", link, ` ${meta.next.label}`);
      line.appendChild(item);
    } else {
      line.appendChild(metaItem("all merged"));
    }
    if (meta.author) {
      line.appendChild(metaItem(meta.author.others ? `${meta.author.login} +${meta.author.others}` : meta.author.login));
    }
    if (meta.age) {
      line.appendChild(metaItem(`${meta.age.oldest} old`, meta.age.oldestTitle));
      if (meta.age.newest) line.appendChild(metaItem(`newest ${meta.age.newest}`, meta.age.newestTitle));
    }
    return line;
  }

  function renderHeader(node, stack, summary, item, meta) {
    const signature = JSON.stringify([stack.id, stack.size, stack.baseBranch, item.folded, summary.counts, meta]);
    renderBody(node, signature, () => {
      const fold = el("button", "ges-fold");
      fold.type = "button";
      fold.setAttribute("aria-expanded", String(!item.folded));
      fold.setAttribute("aria-label", item.folded ? "Unfold stack" : "Fold stack");
      fold.appendChild(svgIcon(ICONS.chevron, "ges-chevron"));

      const title = el("span", "ges-header-title");
      title.append(svgIcon(ICONS.stack, "ges-stack-icon"), `Stack of ${stack.size}`);
      if (stack.baseBranch) title.appendChild(el("span", "ges-muted", ` into ${stack.baseBranch}`));

      const main = el("div", "ges-header-main");
      main.append(title, metaLine(meta));

      const described = core.STATUSES.filter((s) => summary.counts[s] > 0);
      const legendText = described.map((s) => `${summary.counts[s]} ${STATUS_LABELS[s]}`).join(", ");
      const donut = el("button", "ges-donut");
      donut.type = "button";
      // The counts used to be spelled out in the header; keep them in the accessibility tree.
      donut.setAttribute("aria-label", `Stack progress: ${legendText}`);
      donut.appendChild(renderDonut(summary.counts));

      const legend = el("div", "ges-legend");
      legend.id = `ges-legend-${stack.id}`;
      for (const status of described) {
        const count = el("span", "ges-count");
        count.append(el("span", `ges-count-dot ges-s-${status}`), `${summary.counts[status]} ${STATUS_LABELS[status]}`);
        legend.appendChild(count);
      }
      if (!HAS_POPOVER) return [fold, main, donut];
      legend.setAttribute("popover", "");
      donut.setAttribute("popovertarget", legend.id);
      // beforetoggle places it before the first paint; toggle corrects it once it has a size.
      const place = (event) => event.newState === "open" && positionLegend(legend, donut);
      legend.addEventListener("beforetoggle", place);
      legend.addEventListener("toggle", place);
      return [fold, main, donut, legend];
    });
  }

  // Author and age exist only on the rows GitHub put on this page, so both describe what is visible.
  function buildMeta(stack, rowsByNumber, summary) {
    const visible = stack.pulls.map((pull) => rowsByNumber.get(pull.number)).filter(Boolean);
    const span = core.ageSpan(visible.map((row) => row.createdAt));
    const next = core.nextAction(stack, summary.statuses);
    const now = Date.now();
    const oldest = span && core.formatDuration(now - span.oldest);
    const newest = span && core.formatDuration(now - span.newest);
    return {
      author: core.authorSummary(visible.map((row) => row.author)),
      age: span && {
        oldest,
        // Only worth a second item when it actually reads differently.
        newest: newest === oldest ? null : newest,
        oldestTitle: `oldest on this page: ${new Date(span.oldest).toLocaleString()}`,
        newestTitle: `newest on this page: ${new Date(span.newest).toLocaleString()}`,
      },
      next: next && { number: next.pull.number, url: next.pull.url, label: STATUS_LABELS[next.status] },
    };
  }

  function renderGhost(node, pull) {
    const signature = JSON.stringify([pull.number, pull.title, pull.state, pull.url]);
    renderBody(node, signature, () => {
      const icon = svgIcon(ICONS.pull, `ges-ghost-icon ${pull.state === "DRAFT" ? "ges-draft" : "ges-open"}`);
      const link = el("a", "ges-link", pull.title);
      if (pull.url) link.href = pull.url;
      const meta = el("span", "ges-muted", `#${pull.number} · ${pull.state === "DRAFT" ? "draft · " : ""}not on this page`);
      return [icon, link, meta];
    });
  }

  function setOrder(node, order) {
    if (node.style.order !== String(order)) node.style.order = String(order);
  }

  function setFlag(node, name, on, value = "") {
    if (on && node.getAttribute(name) !== value) node.setAttribute(name, value);
    else if (!on && node.hasAttribute(name)) node.removeAttribute(name);
  }

  function clearList(list) {
    list.querySelectorAll(":scope > li[data-ges-synthetic]").forEach((node) => node.remove());
    list.querySelectorAll(":scope > li").forEach((li) => {
      li.querySelector(":scope > .ges-rail")?.remove();
      ["data-ges-stack", "data-ges-hl", "data-ges-hidden", "data-ges-loading"].forEach((name) => li.removeAttribute(name));
      li.style.removeProperty("order");
    });
    list.removeAttribute("data-ges-active");
    list.style.removeProperty("--ges-base-pad");
    list.style.removeProperty("--ges-base-pad-right");
  }

  function updateList(list) {
    const rows = [...list.children]
      .filter((node) => node.tagName === "LI" && !node.hasAttribute("data-ges-synthetic"))
      .map(readRow);

    const stacks = new Map();
    const rowRefs = rows.map((row) => {
      if (!row.pull || !row.badge) return { number: row.pull?.number, stackId: null };
      const stack = cachedStack(row.pull);
      if (!stack) {
        if (needsFetch(row.pull)) pending.set(keyOf(row.pull), { pull: row.pull, size: row.badge.size });
        return { number: row.pull.number, stackId: null };
      }
      stacks.set(stack.id, stack);
      return { number: row.pull.number, stackId: stack.id };
    });
    pumpFetches();

    // Grouping is unknown until the fetch lands, so no header can be placed yet; mark the rows
    // that are about to move instead, and the reflow reads as caused rather than random.
    const markLoading = () =>
      rows.forEach((row) => setFlag(row.li, "data-ges-loading", Boolean(row.badge && row.pull && !cachedStack(row.pull))));

    if (stacks.size === 0) {
      if (list.hasAttribute("data-ges-active")) clearList(list);
      markLoading();
      return;
    }

    if (!list.hasAttribute("data-ges-active")) {
      const rowPadding = getComputedStyle(rows[0].li);
      list.style.setProperty("--ges-base-pad", rowPadding.paddingLeft);
      // So the donut lines up with whatever GitHub keeps at the right of its own rows.
      list.style.setProperty("--ges-base-pad-right", rowPadding.paddingRight);
      list.setAttribute("data-ges-active", "");
    }

    markLoading();

    const summaries = new Map();
    const metas = new Map();
    for (const stack of stacks.values()) {
      const rowsByNumber = new Map();
      rows.forEach((row, i) => rowRefs[i].stackId === stack.id && rowsByNumber.set(row.pull.number, row));
      const summary = core.summarizeStack(stack, rowsByNumber);
      summaries.set(stack.id, summary);
      metas.set(stack.id, buildMeta(stack, rowsByNumber, summary));
    }

    const items = core.buildDisplay(rowRefs, stacks, isFolded);
    const keep = new Set();
    items.forEach((item, order) => {
      let node;
      if (item.kind === "row") {
        node = rows[item.rowIndex].li;
      } else if (item.kind === "header") {
        node = syntheticNode(list, `header:${item.stackId}`, "ges-header");
        renderHeader(node, stacks.get(item.stackId), summaries.get(item.stackId), item, metas.get(item.stackId));
      } else {
        node = syntheticNode(list, `ghost:${item.stackId}:${item.pull.number}`, "ges-ghost");
        renderGhost(node, item.pull);
      }
      keep.add(node);
      setOrder(node, order);
      setFlag(node, "data-ges-hidden", item.hidden);
      setFlag(node, "data-ges-stack", item.stackId != null, String(item.stackId));
      if (item.stackId == null) node.querySelector(":scope > .ges-rail")?.remove();
      else if (!item.hidden) renderRail(node, item);
    });
    list.querySelectorAll(":scope > li[data-ges-synthetic]").forEach((node) => keep.has(node) || node.remove());
  }

  // ---- Interaction --------------------------------------------------------------

  function setHighlight(list, stackId) {
    list.querySelectorAll(":scope > li[data-ges-hl]").forEach((li) => li.removeAttribute("data-ges-hl"));
    list.querySelectorAll(".ges-active").forEach((node) => node.classList.remove("ges-active"));
    if (stackId == null) return;
    const id = CSS.escape(stackId);
    list.querySelectorAll(`:scope > li[data-ges-stack="${id}"]`).forEach((li) => li.setAttribute("data-ges-hl", ""));
    list.querySelectorAll(`.ges-rail [data-stack="${id}"]`).forEach((node) => node.classList.add("ges-active"));
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

  function onClick(event) {
    const header = event.target.closest?.(".ges-header");
    if (!header || event.target.closest("a, .ges-donut, .ges-legend")) return;
    event.preventDefault();
    const stackId = Number(header.getAttribute("data-ges-stack"));
    if (Number.isFinite(stackId)) toggleFold(stackId);
  }

  // ---- Wiring -------------------------------------------------------------------

  let scheduled = false;
  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!settingsLoaded) return;
      document.querySelectorAll(LIST_SELECTOR).forEach((list) => {
        updateList(list);
        resizeObserver.observe(list);
      });
    });
  }

  const isOwnNode = (node) => node instanceof Element && Boolean(node.closest(".ges-rail, .ges-synthetic"));

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
  document.addEventListener("click", onClick);
  loadSettings();
  scheduleUpdate();
})();
