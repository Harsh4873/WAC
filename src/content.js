(() => {
  let index = { tasks: [], blocks: [], visualMode: 'off' };
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
      node.classList.add('wac-event', `wac-effort-${task.effort}`);
      if (index.visualMode === 'patterns') node.classList.add('wac-patterns');
      const badge = document.createElement('span');
      badge.className = 'wac-effort-badge';
      badge.textContent = `${tag} · ${duration}`;
      badge.setAttribute(
        'aria-label',
        `WAC: ${task.effort} effort, ${minutes} minutes estimated total task time`,
      );
      node.append(badge);
      node.title = `${node.title ? `${node.title}\n` : ''}WAC: ${task.effort} effort · estimated total ${duration}`;
    });
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
    }
  }
  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      if (record.type === 'attributes')
        return !['class', 'title', 'data-wac-signature', 'data-wac-original-title'].includes(
          record.attributeName,
        );
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) => !(node.nodeType === 1 && node.classList?.contains('wac-effort-badge')),
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wacState) refresh();
  });
  refresh();
})();
