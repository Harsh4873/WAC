(() => {
  let index = { tasks: [], blocks: [], visualMode: 'off', collisions: [] };
  let timer;
  let alive = true;
  const normalize = (value) =>
    String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
  function cleanup(node) {
    node.classList.remove(
      'wac-event',
      'wac-effort-low',
      'wac-effort-medium',
      'wac-effort-high',
      'wac-patterns',
    );
    node.querySelectorAll(':scope > .wac-effort-badge').forEach((b) => b.remove());
    if (node.dataset.wacOriginalTitle !== undefined) {
      if (node.dataset.wacOriginalTitle) node.title = node.dataset.wacOriginalTitle;
      else node.removeAttribute('title');
      delete node.dataset.wacOriginalTitle;
    }
    delete node.dataset.wacSignature;
    delete node.dataset.wacTaskId;
    delete node.dataset.wacEffort;
    delete node.dataset.wacLabel;
  }
  function paint() {
    if (!alive) return;
    const tasks = new Map(index.tasks.map((t) => [t.id, t]));
    const managed = index.blocks.filter((b) => b.googleSummary && tasks.has(b.taskId));
    // Only decorate WAC-created events. No title guessing against unrelated appointments.
    document.querySelectorAll('[data-eventid], .wac-event').forEach((node) => {
      if (index.visualMode === 'off') {
        if (node.classList.contains('wac-event')) cleanup(node);
        return;
      }
      const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`);
      const match = managed.find((b) => text.includes(normalize(b.googleSummary)));
      if (!match) {
        if (node.classList.contains('wac-event')) cleanup(node);
        return;
      }
      const task = tasks.get(match.taskId);
      const tag = { low: '+', medium: '++', high: '+++' }[task.effort];
      const label = { low: 'Low', medium: 'Medium', high: 'High' }[task.effort] || 'Low';
      const minutes = task.estimateMinutes;
      const duration =
        minutes < 60
          ? `${minutes}m`
          : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
      const signature = `${task.id}:${task.effort}:${minutes}:${index.visualMode}`;
      if (
        node.dataset.wacSignature === signature &&
        node.querySelector(':scope > .wac-effort-badge')
      )
        return;
      cleanup(node);
      node.dataset.wacOriginalTitle = node.getAttribute('title') || '';
      node.dataset.wacSignature = signature;
      node.dataset.wacTaskId = task.id;
      node.dataset.wacEffort = task.effort;
      node.dataset.wacLabel = `${label} · ${duration}`;
      node.classList.add('wac-event', `wac-effort-${task.effort}`);
      if (index.visualMode === 'patterns') node.classList.add('wac-patterns');
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'wac-effort-badge';
      badge.textContent = `${tag} ${label}`;
      badge.setAttribute(
        'aria-label',
        `WAC estimate: ${label} effort, ${tag}, ${minutes} minutes, about ${duration}`,
      );
      node.append(badge);
      node.title = `${node.title ? `${node.title}\n` : ''}WAC: ${label} effort ${tag} · estimated total ${duration}`;
    });
    paintBanner();
  }
  function paintBanner() {
    const existing = document.getElementById('wac-collision-banner');
    if (index.visualMode === 'off' || !index.collisions?.length) {
      existing?.remove();
      return;
    }
    const [first, ...rest] = index.collisions;
    const [year, month, day] = String(first.day).split('-').map(Number);
    const when = new Date(year, (month || 1) - 1, day || 1).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    const minutes = Number(first.minutes) || 0;
    const duration =
      minutes < 60
        ? `${minutes}m`
        : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
    const extra = rest.length
      ? ` ${rest.length} more collision day${rest.length === 1 ? '' : 's'}.`
      : '';
    const text = `WAC · ${when}: ${first.count} deadlines, ${duration}. Move work to an earlier day.${extra}`;
    if (existing?.textContent === text) return;
    existing?.remove();
    const bar = document.createElement('div');
    bar.id = 'wac-collision-banner';
    bar.setAttribute('role', 'status');
    bar.textContent = text;
    (document.body || document.documentElement).prepend(bar);
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(paint, 180);
  };
  async function refresh() {
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'GET_CONTENT_STATE' });
      if (reply?.ok) {
        index = reply.data;
        schedule();
      }
    } catch {
      // Existing Calendar tabs can outlive an extension reload.
      alive = false;
      observer.disconnect();
      clearTimeout(timer);
      document.querySelectorAll('.wac-event').forEach(cleanup);
      document.getElementById('wac-collision-banner')?.remove();
    }
  }
  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      if (record.type === 'attributes')
        return !['class', 'title', 'data-wac-signature', 'data-wac-original-title'].includes(
          record.attributeName,
        );
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          !(
            node.nodeType === 1 &&
            (node.classList?.contains('wac-effort-badge') ||
              node.classList?.contains('wac-estimate-choice') ||
              node.id === 'wac-collision-banner' ||
              node.id === 'wac-estimate-popover')
          ),
      );
    });
    if (relevant) schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-eventid', 'aria-label'],
  });
  document.addEventListener(
    'click',
    async (event) => {
      const choice = event.target.closest?.('.wac-estimate-choice');
      if (choice) {
        event.preventDefault();
        event.stopPropagation();
        const reply = await chrome.runtime.sendMessage({
          type: 'SET_EFFORT',
          id: choice.dataset.wacTask,
          effort: choice.dataset.wacEffort,
        });
        document.getElementById('wac-estimate-popover')?.remove();
        if (reply?.ok) refresh();
        return;
      }
      const badge = event.target.closest?.('.wac-effort-badge');
      if (!badge) {
        if (!event.target.closest?.('#wac-estimate-popover'))
          document.getElementById('wac-estimate-popover')?.remove();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const host = badge.closest('.wac-event');
      if (!host?.dataset.wacTaskId) return;
      document.getElementById('wac-estimate-popover')?.remove();
      const pop = document.createElement('div');
      pop.id = 'wac-estimate-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Override estimate');
      const title = document.createElement('p');
      title.textContent = `Estimate · ${host.dataset.wacLabel || 'effort'}`;
      const row = document.createElement('div');
      for (const [tier, name, tag] of [
        ['low', 'Low', '+'],
        ['medium', 'Medium', '++'],
        ['high', 'High', '+++'],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wac-estimate-choice';
        button.dataset.wacEffort = tier;
        button.dataset.wacTask = host.dataset.wacTaskId;
        button.textContent = `${tag} ${name}`;
        button.setAttribute('aria-pressed', tier === host.dataset.wacEffort ? 'true' : 'false');
        row.append(button);
      }
      const note = document.createElement('p');
      note.textContent = 'One click changes the effort label. The hours stay the same.';
      pop.append(title, row, note);
      document.body.append(pop);
      const rect = badge.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      let top = rect.bottom + 6;
      if (top + popRect.height > window.innerHeight - 8)
        top = Math.max(8, rect.top - popRect.height - 6);
      pop.style.top = `${top}px`;
      pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 230))}px`;
    },
    true,
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wacState) refresh();
  });
  refresh();
})();
