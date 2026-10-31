import { send, subscribe, isExtension } from './bridge.mjs';
import { openGoogleCalendar, GOOGLE_CALENDAR_URL } from './calendar-navigation.mjs';
import { DEFAULT_PROFILE } from './profile.mjs';
import { analyzeAssignment } from './analysis-client.mjs';
import { attachmentMetadata, MAX_TEXT_LENGTH, MAX_FILE_BYTES } from './analysis-contract.mjs';
import {
  TYPES,
  estimateTask,
  tierTag,
  formatMinutes,
  plannedMinutes,
  blockDuration,
  dayKey,
  localInput,
  startOfWeek,
  addDays,
  atHour,
  demoBusy,
} from './core.mjs';

const $ = (selector) => document.querySelector(selector);
if (isExtension) document.documentElement.classList.add('extension-panel');
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const dateLabel = (date) =>
  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const timeLabel = (date) =>
  new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const longDate = (date) =>
  new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
let state,
  configured = false,
  week = startOfWeek(new Date());
let editId = null,
  proposal = null,
  publishingIds = [],
  activeTab = 'tasks';
let toastTimer, refreshTimer, confirmCallback;
let draftAnalysis = null,
  attachedFile = null,
  attachedMetadata = null,
  analysisAbort = null,
  analysisGeneration = 0,
  formRevision = 0,
  planningTaskId = null,
  attachmentSelection = null;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(
    () => {
      $('#toast').hidden = true;
    },
    error ? 8000 : 4500,
  );
}
async function refresh() {
  const result = await send('GET_STATE');
  state = result.state;
  configured = result.configured;
  render();
}
async function work(button, action, errorSelector) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  if (errorSelector) $(errorSelector).hidden = true;
  try {
    await action();
  } catch (error) {
    if (errorSelector) {
      $(errorSelector).textContent = error.message;
      $(errorSelector).hidden = false;
    } else toast(error.message, true);
  } finally {
    if (button) button.disabled = false;
    try {
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }
}
function dueText(task) {
  const hours = (new Date(task.due) - new Date()) / 3600000;
  if (task.completed) return '<span class="due-label">Complete</span>';
  if (hours < 0) return '<span class="due-label overdue">Overdue</span>';
  const text = hours < 24 ? `Due ${Math.ceil(hours)}h from now` : `Due ${dateLabel(task.due)}`;
  return `<span class="due-label ${hours < 48 ? 'urgent' : ''}">${escape(text)}</span>`;
}
function renderTask(task) {
  const planned = plannedMinutes(task.id, state.blocks);
  const mode = state.settings.visualMode;
  const hasPublished = state.blocks.some((b) => b.taskId === task.id && b.googleEventId);
  return `<article class="task-card ${task.completed ? 'completed' : ''}" style="--course-color:${escape(task.color)}">
    <div class="task-top"><span class="course-label">${escape(task.course)}</span>${dueText(task)}</div>
    <div class="task-heading"><button class="complete-button" data-action="complete" data-id="${task.id}" aria-pressed="${task.completed}" aria-label="${task.completed ? 'Mark incomplete' : 'Complete'}: ${escape(task.title)}">${task.completed ? '✓' : ''}</button><h3>${escape(task.title)}${mode !== 'off' ? `<span class="effort-badge ${task.effort}" title="${task.effort} effort">${tierTag(task.effort)} ${task.effort}</span>` : ''}</h3></div>
    <div class="task-meta"><span>${formatMinutes(task.estimateMinutes)} ${task.analysis ? (task.analysis.estimate.minutes !== task.estimateMinutes ? 'your estimate' : task.analysis.provider === 'demo' ? 'demo estimate' : 'AI estimate') : 'estimated'}</span><span class="dot"></span><span>${planned ? `${formatMinutes(planned)} planned` : 'Not planned yet'}</span></div>
    ${task.analysis ? `<p class="task-analysis-note">${task.analysis.provider === 'demo' ? 'Demo draft · no AI call' : `Complexity: ${escape(task.analysis.complexity)}`} · suggested range ${formatMinutes(task.analysis.estimate.lowMinutes)}–${formatMinutes(task.analysis.estimate.highMinutes)}</p>` : ''}
    ${task.attachment ? `<p class="task-attachment">Attachment: ${escape(task.attachment.name)} · file details only</p>` : ''}
    ${planned ? `<div class="progress-track" aria-label="${Math.min(100, Math.round((planned / task.estimateMinutes) * 100))}% planned"><span style="width:${Math.min(100, (planned / task.estimateMinutes) * 100)}%"></span></div>` : ''}
    <div class="task-bottom"><div class="effort-chips" aria-label="Override effort for ${escape(task.title)}">${['low', 'medium', 'high'].map((t) => `<button data-action="effort" data-id="${task.id}" data-effort="${t}" aria-label="${t} effort: ${escape(task.title)}" aria-pressed="${task.effort === t}">${tierTag(t)}</button>`).join('')}</div><button class="task-edit" data-action="edit" data-id="${task.id}" title="Edit assignment" aria-label="Edit ${escape(task.title)}">Edit</button><button class="task-delete" data-action="delete" data-id="${task.id}" title="${hasPublished ? 'Delete published events in Calendar and refresh first' : 'Remove assignment'}" aria-label="Remove ${escape(task.title)}">×</button><button class="plan-button" data-action="plan" data-id="${task.id}" ${task.completed || planned >= task.estimateMinutes ? 'disabled' : ''}>${planned >= task.estimateMinutes ? '✓ Planned' : 'Find time ↗'}</button></div>
  </article>`;
}
function safeGoogleLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
      (u.hostname === 'google.com' || u.hostname.endsWith('.google.com'))
      ? escape(u.href)
      : '';
  } catch {
    return '';
  }
}
function render() {
  const now = new Date();
  const active = state.tasks.filter((t) => !t.completed);
  const total = active.reduce((n, t) => n + t.estimateMinutes, 0);
  const planned = active.reduce((n, t) => n + plannedMinutes(t.id, state.blocks), 0);
  const dueSoon = active.filter(
    (t) => new Date(t.due) >= now && new Date(t.due) <= addDays(now, 7),
  );
  $('#total-effort').textContent = formatMinutes(total);
  $('#planned-effort').textContent = formatMinutes(planned);
  $('#due-count').textContent = dueSoon.length;
  $('#task-count').textContent = active.length;
  $('#block-count').textContent = state.blocks.length;
  const clusters = new Map();
  for (const task of dueSoon) {
    const key = dayKey(task.due);
    const group = clusters.get(key) || [];
    group.push(task);
    clusters.set(key, group);
  }
  const collision = [...clusters.values()]
    .sort(
      (a, b) =>
        b.reduce((n, t) => n + t.estimateMinutes, 0) - a.reduce((n, t) => n + t.estimateMinutes, 0),
    )
    .find(
      (g) =>
        g.length > 1 && g.reduce((n, t) => n + t.estimateMinutes, 0) > state.settings.dailyLimit,
    );
  const overdue = active.filter((t) => new Date(t.due) < now).length;
  $('#workload-notice').hidden = !collision && !overdue;
  if (collision)
    $('#workload-notice').innerHTML =
      `<strong>A busy ${escape(new Date(collision[0].due).toLocaleDateString('en-US', { weekday: 'long' }))} ahead.</strong>${collision.length} deadlines, ${formatMinutes(collision.reduce((n, t) => n + t.estimateMinutes, 0))} total effort. Spread some work across earlier days.`;
  else if (overdue)
    $('#workload-notice').textContent =
      `${overdue} overdue assignment${overdue > 1 ? 's' : ''}. Update the deadline before finding new work time.`;
  const sorted = [...state.tasks].sort(
    (a, b) => Number(a.completed) - Number(b.completed) || new Date(a.due) - new Date(b.due),
  );
  $('#task-list').innerHTML = sorted.length
    ? sorted.map(renderTask).join('')
    : '<div class="empty-state"><strong>A little breathing room.</strong>Add an assignment or load examples to get started.</div>';
  $('#plan-list').innerHTML = state.blocks.length
    ? [...state.blocks]
        .sort((a, b) => new Date(a.start) - new Date(b.start))
        .map((block) => {
          const task = state.tasks.find((t) => t.id === block.taskId);
          const link = safeGoogleLink(block.htmlLink);
          return `<article class="plan-item"><div class="plan-date">${escape(new Date(block.start).toLocaleDateString('en-US', { weekday: 'short' }))}<strong>${new Date(block.start).getDate()}</strong></div><div><h3>${escape(task?.title || 'Work block')}</h3><p>${escape(timeLabel(block.start))}–${escape(timeLabel(block.end))} · ${formatMinutes(blockDuration(block))}</p><p>${escape(task?.course || '')}</p></div><span class="plan-state">${block.googleEventId ? (link ? `<a href="${link}" target="_blank" rel="noopener noreferrer">In Calendar ↗</a>` : 'In Calendar') : 'Local plan'}</span></article>`;
        })
        .join('') +
      `<button class="text-button" id="clear-local-plans">Clear unpublished work blocks</button>`
    : '<div class="empty-state"><strong>Start small. Start a little earlier.</strong>Choose “Find time” on an assignment to break it into manageable work blocks.</div>';
  for (const button of document.querySelectorAll('[data-mode]'))
    button.setAttribute('aria-pressed', button.dataset.mode === state.settings.visualMode);
  $('#display-help').textContent = {
    off: 'Calendar labels and patterns are hidden.',
    tags: 'Effort in words and symbols, alongside course colors.',
    patterns: 'Course colors stay. Text and patterns add effort.',
  }[state.settings.visualMode];
  $('#connection-status').classList.toggle('connected', state.google.connected);
  $('#connection-status').innerHTML =
    `<i></i> ${state.google.connected ? 'Google connected' : 'Demo workspace'}`;
  $('#google-description').textContent = state.google.connected
    ? 'Your primary calendar helps us find free time.'
    : 'Try the demo, then connect your real week.';
  $('#connect-button').hidden = state.google.connected;
  $('#refresh-button').hidden = !state.google.connected;
  $('#publish-button').hidden = !state.google.connected;
  $('#publish-button').disabled = !state.blocks.some((b) => !b.googleEventId);
  $('#google-note').textContent = state.google.connected
    ? 'Plans stay local until you publish. Refresh after moving events in Google Calendar.'
    : 'Demo plans stay on this device. Nothing is sent to Google.';
  updateConnectionGuide();
  $('#calendar-note').textContent = state.google.connected
    ? 'Primary Google Calendar · use Refresh to pull changes.'
    : 'Sample classes help make the demo realistic.';
  if (!isExtension) renderCalendar();
}
function renderCalendar() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = dayKey(new Date());
  $('#week-title').textContent =
    `${week.toLocaleDateString('en-US', { month: 'long' })} ${week.getFullYear()}`;
  $('#week-subtitle').textContent =
    `${dateLabel(week)} – ${dateLabel(days[6])} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  const mode = state.settings.visualMode;
  const busy = state.google.connected ? state.calendarEvents.filter((e) => !e.wac) : demoBusy(week);
  const events = [
    ...busy.map((e) => ({ ...e, work: false })),
    ...state.blocks.map((b) => ({
      ...b,
      work: true,
      task: state.tasks.find((t) => t.id === b.taskId),
    })),
  ];
  $('#calendar').innerHTML =
    `<div class="week-head"><div></div>${days.map((day) => `<div class="day-heading ${dayKey(day) === today ? 'today' : ''}"><span>${day.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>${day.getDate()}</strong></div>`).join('')}</div>
    <div class="week-deadlines"><div class="deadline-gutter">DUE</div>${days
      .map((day) => {
        const due = state.tasks.filter((t) => !t.completed && dayKey(t.due) === dayKey(day));
        return `<div class="deadline-day">${due.map((t) => `<button class="deadline-chip ${t.effort === 'high' ? 'heavy' : ''} ${mode === 'patterns' ? `pattern-${t.effort}` : ''}" data-action="edit" data-id="${t.id}" title="${escape(`${t.title} · ${formatMinutes(t.estimateMinutes)} estimated · due ${timeLabel(t.due)}`)}">${mode !== 'off' ? `${tierTag(t.effort)} ` : ''}${escape(t.title)}</button>`).join('')}${busy
          .filter((e) => e.allDay && dayKey(e.start) <= dayKey(day) && dayKey(e.end) > dayKey(day))
          .map(
            (e) =>
              `<span class="deadline-chip" title="${escape(e.title)}">${escape(e.title)}</span>`,
          )
          .join('')}</div>`;
      })
      .join(
        '',
      )}</div><div class="week-body"><div class="time-gutter">${Array.from({ length: 14 }, (_, i) => `<span class="time-label" style="top:${i * 52}px">${i + 8 > 12 ? i - 4 : i + 8}${i + 8 >= 12 ? 'p' : 'a'}</span>`).join('')}</div>${days
      .map((day) => {
        const visible = events.filter(
          (e) => !e.allDay && dayKey(e.start) <= dayKey(day) && dayKey(e.end) >= dayKey(day),
        );
        const positioned = visible
          .map((event) => {
            const start = new Date(event.start),
              end = new Date(event.end);
            const startMinute =
              dayKey(start) < dayKey(day) ? 0 : start.getHours() * 60 + start.getMinutes();
            const endMinute =
              dayKey(end) > dayKey(day) ? 1440 : end.getHours() * 60 + end.getMinutes();
            return { ...event, from: Math.max(480, startMinute), to: Math.min(1320, endMinute) };
          })
          .filter((e) => e.to > e.from)
          .sort((a, b) => a.from - b.from || b.to - a.to);
        // Assign overlapping events separate columns, including real-calendar overlaps.
        let cluster = [],
          clusterEnd = -1;
        const placeCluster = () => {
          const ends = [];
          for (const event of cluster) {
            let col = ends.findIndex((end) => end <= event.from);
            if (col < 0) col = ends.length;
            ends[col] = event.to;
            event.col = col;
          }
          for (const event of cluster) event.columns = ends.length;
        };
        for (const event of positioned) {
          if (event.from >= clusterEnd) {
            placeCluster();
            cluster = [];
            clusterEnd = -1;
          }
          cluster.push(event);
          clusterEnd = Math.max(clusterEnd, event.to);
        }
        placeCluster();
        return `<div class="day-lane ${dayKey(day) === today ? 'today' : ''}">${positioned
          .map((e) => {
            const title = e.work ? e.task?.title || 'Work block' : e.title;
            const top = ((e.from - 480) / 60) * 52,
              height = ((e.to - e.from) / 60) * 52;
            const action = e.work && e.task ? `data-action="edit" data-id="${e.task.id}"` : '';
            return `<button class="calendar-event ${e.work ? 'work' : ''} ${e.work && mode === 'patterns' ? `pattern-${e.task?.effort}` : ''}" ${action} style="top:${top}px;height:${height}px;left:calc(${(e.col / e.columns) * 100}% + 3px);width:calc(${100 / e.columns}% - 6px);right:auto" title="${escape(`${title} · ${timeLabel(e.start)}–${timeLabel(e.end)}`)}"><strong>${escape(title)}</strong>${height > 28 ? `<small>${escape(timeLabel(e.start))}</small>` : ''}${e.work && mode !== 'off' && height > 45 ? `<span class="event-effort">${tierTag(e.task?.effort)} ${formatMinutes(blockDuration(e))}</span>` : ''}</button>`;
          })
          .join('')}</div>`;
      })
      .join('')}</div>`;
}
function setTab(tab, focus = false) {
  activeTab = tab;
  for (const name of ['tasks', 'plan']) {
    const selected = tab === name;
    const button = $(`#${name}-tab`);
    button.setAttribute('aria-selected', selected);
    button.tabIndex = selected ? 0 : -1;
  }
  $('#task-list').hidden = tab !== 'tasks';
  $('#plan-list').hidden = tab !== 'plan';
  if (focus) $(`#${tab}-tab`).focus();
}
function updateEstimate() {
  try {
    const data = Object.fromEntries(new FormData($('#task-form')));
    const estimate = draftAnalysis
      ? {
          low: draftAnalysis.estimate.lowMinutes,
          high: draftAnalysis.estimate.highMinutes,
          minutes: draftAnalysis.estimate.minutes,
          reason: draftAnalysis.reasons.join(' '),
        }
      : estimateTask({ ...data, profile: state.profile });
    $('#estimate-value').textContent =
      `${formatMinutes(estimate.low)}–${formatMinutes(estimate.high)}`;
    $('#estimate-reason').textContent = estimate.reason;
    $('.estimate-preview small').textContent = draftAnalysis
      ? draftAnalysis.provider === 'demo'
        ? 'Fixed demo suggestion. No AI call was made.'
        : 'AI suggestion. Your experience gets the final say.'
      : 'Rule-based starting point. Your experience gets the final say.';
    $('#task-estimate').placeholder = `${estimate.minutes} min · suggested`;
    $('#size-label').textContent = `Number of ${TYPES[data.type].unit}`;
    $('#text-count').textContent =
      `${String(data.description || '').length.toLocaleString()} / 60,000 characters`;
  } catch (error) {
    $('#estimate-value').textContent = '—';
    $('#estimate-reason').textContent = error.message;
  }
}
function openTask(id = null) {
  editId = id;
  const form = $('#task-form');
  form.reset();
  const task = state.tasks.find((t) => t.id === id);
  analysisAbort?.abort();
  analysisGeneration++;
  formRevision = 0;
  attachedFile = null;
  attachedMetadata = task?.attachment || null;
  draftAnalysis = task?.analysis || null;
  $('#analyze-assignment').disabled = false;
  $('#assignment-file').value = '';
  $('#analysis-error').hidden = true;
  $('#analysis-progress').textContent = '';
  form.elements.course.value = task?.course || '';
  $('#task-dialog-title').textContent = task
    ? 'Your experience gets the final say.'
    : 'A little detail. A clearer plan.';
  if (task)
    for (const key of [
      'title',
      'course',
      'description',
      'type',
      'size',
      'familiarity',
      'estimateMinutes',
      'effort',
    ])
      form.elements[key].value = task[key];
  $('#task-due').value = localInput(task ? new Date(task.due) : atHour(addDays(new Date(), 3), 23));
  $('#task-error').hidden = true;
  renderAttachment();
  renderAnalysis();
  updateEstimate();
  $('#task-dialog').showModal();
}
function openProfile(firstUse = false) {
  const profile = state.profile || DEFAULT_PROFILE;
  const form = $('#profile-form');
  for (const [key, value] of Object.entries(DEFAULT_PROFILE))
    form.elements[key].value = profile[key] ?? value;
  $('#skip-profile').hidden = !firstUse;
  $('#profile-error').hidden = true;
  $('#profile-dialog').showModal();
}
function renderAttachment() {
  $('#attachment-details').hidden = !attachedMetadata;
  $('#attachment-name').textContent = attachedMetadata
    ? `${attachedMetadata.name} · ${Math.ceil(attachedMetadata.size / 1024)} KB${attachedFile ? '' : ' · reattach to analyze again'}`
    : '';
}
function renderAnalysis() {
  $('#analysis-result').hidden = !draftAnalysis;
  if (!draftAnalysis) return;
  $('#analysis-source').textContent =
    draftAnalysis.provider === 'demo' ? 'Demo draft · no AI call made' : 'AI task draft';
  $('#analysis-complexity').textContent = `Complexity: ${draftAnalysis.complexity}`;
  $('#analysis-summary').textContent = draftAnalysis.summary;
  $('#analysis-steps').innerHTML = draftAnalysis.steps
    .map(
      (step) =>
        `<div class="analysis-step"><span>${escape(step.title)}</span><span>${formatMinutes(step.minutes)}</span></div>`,
    )
    .join('');
  $('#analysis-context').innerHTML = ['reasons', 'assumptions', 'questions']
    .filter((key) => draftAnalysis[key].length)
    .map(
      (key) =>
        `<div class="analysis-context"><strong>${{ reasons: 'Why this complexity', assumptions: 'Assumptions', questions: 'Please check' }[key]}</strong><ul>${draftAnalysis[key].map((line) => `<li>${escape(line)}</li>`).join('')}</ul></div>`,
    )
    .join('');
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}
function updateConnectionGuide() {
  $('#calendar-connection-status').textContent = !isExtension
    ? 'You are viewing a preview. Open the WAC Chrome extension to connect your calendar.'
    : !configured
      ? 'Calendar connection is not available in this build yet. Contact the WAC team, or continue planning locally.'
      : state.google.connected
        ? 'Your Google Calendar is connected. Use Refresh in WAC after moving events in Google Calendar.'
        : 'Ready to connect. Continue with Google and review the permissions it requests.';
  $('#settings-connect-button').hidden = state.google.connected;
  $('#settings-connect-button').disabled = !isExtension || !configured;
  $('#disconnect-button').hidden = !state.google.connected;
}
function openSettings(showConnectionGuide = false) {
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(state.settings))
    if (form.elements[key]) {
      if (form.elements[key].type === 'checkbox') form.elements[key].checked = value;
      else form.elements[key].value = String(value);
    }
  updateConnectionGuide();
  $('#calendar-guide').open = showConnectionGuide;
  $('#settings-error').hidden = true;
  $('#settings-dialog').showModal();
}
function confirmAction(title, description, callback) {
  $('#confirm-title').textContent = title;
  $('#confirm-description').textContent = description;
  confirmCallback = callback;
  $('#confirm-dialog').showModal();
}
async function showPlan(id, button) {
  planningTaskId = id;
  proposal = null;
  const task = state.tasks.find((t) => t.id === id);
  $('#plan-title').textContent = task.title;
  $('#split-mode').value = 'uniform';
  $('#custom-block-lengths').value = '';
  $('#plan-block-length').value = task.blockMinutes || state.settings.blockMinutes;
  $('#proposal-list').innerHTML = '';
  $('#save-plan').disabled = true;
  $('#plan-error').hidden = true;
  updateSplitControls(false);
  $('#plan-dialog').showModal();
  await refreshProposal(button);
}
function planOptions() {
  const custom = $('#split-mode').value === 'custom' ? $('#custom-block-lengths').value.trim() : '';
  if ($('#split-mode').value === 'custom' && !custom)
    throw new Error('Enter your block lengths, separated by commas.');
  const customDurations = custom ? custom.split(/[,;\s]+/).map(Number) : [];
  if (customDurations.some((n) => !Number.isInteger(n) || n < 5 || n > 240))
    throw new Error('Each custom block must be a whole number between 5 and 240 minutes.');
  return {
    blockMinutes: customDurations.length
      ? Math.max(...customDurations)
      : Number($('#plan-block-length').value),
    customDurations,
  };
}
function updateSplitControls(invalidate = true) {
  const custom = $('#split-mode').value === 'custom';
  $('#custom-lengths-label').hidden = !custom;
  $('#uniform-length-label').hidden = custom;
  $('#block-presets').hidden = custom;
  for (const button of document.querySelectorAll('[data-minutes]'))
    button.setAttribute(
      'aria-pressed',
      Number(button.dataset.minutes) === Number($('#plan-block-length').value),
    );
  const task = state.tasks.find((t) => t.id === planningTaskId);
  const remaining = task
    ? Math.max(0, task.estimateMinutes - plannedMinutes(task.id, state.blocks))
    : 0;
  const sum = custom
    ? $('#custom-block-lengths')
        .value.trim()
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map(Number)
        .reduce((n, v) => n + v, 0)
    : 0;
  $('#split-summary').textContent =
    `${formatMinutes(remaining)} remaining.${custom ? ` Your blocks total ${Number.isFinite(sum) ? formatMinutes(sum) : '—'}.` : ' The final block may be shorter to match the estimate.'}${invalidate ? ' Click Update plan to apply these lengths.' : ''}`;
  if (invalidate) {
    proposal = null;
    $('#save-plan').disabled = true;
  }
}
async function refreshProposal(button) {
  const id = planningTaskId;
  await work(
    button,
    async () => {
      const options = planOptions();
      const fingerprint = JSON.stringify(options);
      $('#save-plan').disabled = true;
      $('#plan-error').hidden = true;
      $('#plan-description').textContent = 'Finding available times for your chosen block lengths…';
      const result = await send('PLAN', { id, options });
      if (
        planningTaskId !== id ||
        !$('#plan-dialog').open ||
        JSON.stringify(planOptions()) !== fingerprint
      )
        return;
      proposal = result;
      updateSplitControls(false);
      $('#plan-description').textContent =
        `${proposal.blocks.length} suggested work blocks. ${proposal.realCalendar ? 'Checked against your primary Google Calendar.' : 'Demo mode: checked against sample classes.'} Saving keeps this plan local.`;
      $('#proposal-list').innerHTML = proposal.blocks
        .map(
          (b) =>
            `<div class="proposal-item"><div><strong>${escape(longDate(b.start))}</strong><p>${escape(timeLabel(b.start))} – ${escape(timeLabel(b.end))}</p></div><span>${formatMinutes(blockDuration(b))}</span></div>`,
        )
        .join('');
      $('#plan-warning').hidden = !proposal.unscheduledMinutes;
      $('#plan-warning').textContent =
        `${formatMinutes(proposal.unscheduledMinutes)} remains unplanned. Your block choices, available times, daily limit, or deadline may leave part of this task unscheduled. You can save these blocks as a partial plan.`;
      $('#save-plan').disabled = !proposal.blocks.length;
      if (!proposal.requestedMinutes) {
        $('#plan-warning').hidden = false;
        $('#plan-warning').textContent = 'This assignment is already fully planned.';
      }
      $('#plan-error').hidden = true;
    },
    '#plan-error',
  );
}
document.addEventListener('click', (event) => {
  const close = event.target.closest('.close-dialog');
  if (close) {
    close.closest('dialog').close();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'edit') openTask(id);
  if (action === 'plan') showPlan(id, button);
  if (action === 'effort')
    work(button, async () => {
      await send('SET_EFFORT', { id, effort: button.dataset.effort });
    });
  if (action === 'complete')
    work(button, async () => {
      await send('COMPLETE_TASK', { id });
    });
  if (action === 'delete')
    confirmAction(
      'Remove this assignment?',
      'This removes the task and its unpublished work blocks from this device. Tasks with published events must have those events deleted in Google Calendar first.',
      async () => {
        await send('DELETE_TASK', { id });
      },
    );
});
$('#new-task').addEventListener('click', () => openTask());
$('#task-form').addEventListener('input', (event) => {
  formRevision++;
  if (draftAnalysis && ['description', 'familiarity'].includes(event.target.name)) {
    draftAnalysis = null;
    renderAnalysis();
    $('#analysis-progress').textContent =
      'Instructions changed. Analyze again, or keep your own estimate.';
  }
  updateEstimate();
});
$('#task-type').addEventListener('change', () => {
  $('#task-size').value = TYPES[$('#task-type').value].defaultSize;
  updateEstimate();
});
$('#task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  work(
    event.submitter,
    async () => {
      const task = Object.fromEntries(new FormData(event.target));
      task.analysis = draftAnalysis;
      task.attachment = attachedMetadata;
      await send('SAVE_TASK', { task, id: editId });
      $('#task-dialog').close();
      toast(editId ? 'Assignment updated.' : 'A little more clarity. Assignment added.');
    },
    '#task-error',
  );
});
$('#save-plan').addEventListener('click', (event) =>
  work(
    event.currentTarget,
    async () => {
      if (!proposal) throw new Error('Update the plan before saving.');
      await send('SAVE_PLAN', {
        id: proposal.taskId,
        blocks: proposal.blocks,
        options: proposal.options,
      });
      if (proposal.blocks[0]) week = startOfWeek(new Date(proposal.blocks[0].start));
      $('#plan-dialog').close();
      setTab('plan');
      toast('Work blocks saved locally. Your breathing room is protected.');
    },
    '#plan-error',
  ),
);
$('#settings-button').addEventListener('click', () => openSettings());
$('#edit-profile').addEventListener('click', () => {
  $('#settings-dialog').close();
  openProfile(false);
});
$('#profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  work(
    event.submitter,
    async () => {
      await send('SAVE_PROFILE', { profile: Object.fromEntries(new FormData(event.target)) });
      $('#profile-dialog').close();
      updateEstimate();
      toast('Your learning preferences are saved. New estimates will use them.');
    },
    '#profile-error',
  );
});
$('#skip-profile').addEventListener('click', (event) =>
  work(
    event.currentTarget,
    async () => {
      await send('SAVE_PROFILE', { profile: { ...DEFAULT_PROFILE }, skipped: true });
      $('#profile-dialog').close();
    },
    '#profile-error',
  ),
);
$('#assignment-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const selection = Symbol();
  attachmentSelection = selection;
  formRevision++;
  analysisAbort?.abort();
  $('#analysis-error').hidden = true;
  try {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mimeType =
      extension === 'pdf'
        ? 'application/pdf'
        : extension === 'txt'
          ? 'text/plain'
          : extension === 'md'
            ? 'text/markdown'
            : null;
    if (!mimeType) throw new Error('Choose a PDF, TXT, or Markdown file.');
    if (file.size > MAX_FILE_BYTES || !file.size)
      throw new Error('Choose a non-empty file no larger than 6 MB.');
    if (mimeType !== 'application/pdf') {
      const content = await file.text();
      if (attachmentSelection !== selection) return;
      const current = $('#task-description').value;
      const combined = `${current ? `${current}\n\n` : ''}Attached instructions (${file.name}):\n${content}`;
      if (combined.length > MAX_TEXT_LENGTH)
        throw new Error(
          'This text file is too long. Paste the relevant sections, up to 60,000 characters.',
        );
      $('#task-description').value = combined;
    } else {
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (attachmentSelection !== selection) return;
      if (String.fromCharCode(...header) !== '%PDF-')
        throw new Error('The selected file does not contain a PDF document.');
    }
    attachedFile = file;
    attachedMetadata = attachmentMetadata({ name: file.name, mimeType, size: file.size });
    draftAnalysis = null;
    renderAttachment();
    renderAnalysis();
    updateEstimate();
  } catch (error) {
    if (attachmentSelection === selection) {
      $('#analysis-error').textContent = error.message;
      $('#analysis-error').hidden = false;
      event.target.value = '';
    }
  }
});
$('#remove-attachment').addEventListener('click', () => {
  attachmentSelection = null;
  formRevision++;
  analysisAbort?.abort();
  attachedFile = null;
  attachedMetadata = null;
  draftAnalysis = null;
  $('#assignment-file').value = '';
  renderAttachment();
  renderAnalysis();
  updateEstimate();
});
$('#task-dialog').addEventListener('close', () => {
  analysisAbort?.abort();
  analysisGeneration++;
  attachmentSelection = null;
});
$('#analyze-assignment').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;
  const generation = ++analysisGeneration,
    revision = formRevision;
  const abort = new AbortController();
  analysisAbort?.abort();
  analysisAbort = abort;
  button.disabled = true;
  $('#analysis-error').hidden = true;
  $('#analysis-progress').textContent = 'Analyzing your assignment…';
  try {
    const form = $('#task-form');
    if (attachedMetadata?.mimeType === 'application/pdf' && !attachedFile)
      throw new Error(
        'Reattach the PDF to include it in analysis, or remove it to analyze the text only.',
      );
    const attachment =
      attachedFile && attachedMetadata?.mimeType === 'application/pdf'
        ? { ...attachedMetadata, data: await fileBase64(attachedFile) }
        : null;
    const result = await analyzeAssignment(
      {
        text: form.elements.description.value,
        attachment,
        profile: state.profile || DEFAULT_PROFILE,
        task: {
          title: form.elements.title.value,
          course: form.elements.course.value,
          type: form.elements.type.value,
          familiarity: form.elements.familiarity.value,
        },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { signal: abort.signal },
    );
    if (abort.signal.aborted || generation !== analysisGeneration || !$('#task-dialog').open)
      return;
    if (revision !== formRevision)
      throw new Error(
        'The assignment changed during analysis. Analyze again to use your updated instructions.',
      );
    draftAnalysis = result;
    form.elements.title.value = result.title;
    form.elements.type.value = result.type;
    form.elements.size.value = TYPES[result.type].defaultSize;
    form.elements.estimateMinutes.value = result.estimate.minutes;
    form.elements.effort.value = '';
    $('#task-due').value = result.deadline ? localInput(result.deadline) : '';
    renderAnalysis();
    updateEstimate();
    $('#analysis-progress').textContent =
      result.provider === 'demo'
        ? 'Demo result · no AI call made'
        : 'Draft ready. Review the details before saving.';
  } catch (error) {
    if (!abort.signal.aborted && generation === analysisGeneration) {
      $('#analysis-error').textContent = error.message;
      $('#analysis-error').hidden = false;
      $('#analysis-progress').textContent = '';
    }
  } finally {
    if (generation === analysisGeneration) {
      button.disabled = false;
      analysisAbort = null;
      if (abort.signal.aborted) $('#analysis-progress').textContent = '';
    }
  }
});
$('#split-mode').addEventListener('change', () => updateSplitControls());
$('#plan-block-length').addEventListener('input', () => updateSplitControls());
$('#custom-block-lengths').addEventListener('input', () => updateSplitControls());
$('#block-presets').addEventListener('click', (event) => {
  const button = event.target.closest('[data-minutes]');
  if (!button) return;
  $('#plan-block-length').value = button.dataset.minutes;
  updateSplitControls();
});
$('#update-plan').addEventListener('click', (event) => refreshProposal(event.currentTarget));
$('#plan-dialog').addEventListener('close', () => {
  planningTaskId = null;
  proposal = null;
});
$('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  work(
    event.submitter,
    async () => {
      const settings = Object.fromEntries(new FormData(event.target));
      settings.weekends = event.target.elements.weekends.checked;
      await send('SET_SETTINGS', { settings });
      $('#settings-dialog').close();
      toast('Your rhythm, saved.');
    },
    '#settings-error',
  );
});
$('#display-modes').addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button) return;
  work(button, () => send('SET_SETTINGS', { settings: { visualMode: button.dataset.mode } }));
});
$('#tasks-tab').addEventListener('click', () => setTab('tasks'));
$('#plan-tab').addEventListener('click', () => setTab('plan'));
$('.tabs').addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    setTab(
      event.key === 'Home'
        ? 'tasks'
        : event.key === 'End'
          ? 'plan'
          : activeTab === 'tasks'
            ? 'plan'
            : 'tasks',
      true,
    );
  }
});
$('#prev-week').addEventListener('click', () => {
  week = addDays(week, -7);
  renderCalendar();
});
$('#next-week').addEventListener('click', () => {
  week = addDays(week, 7);
  renderCalendar();
});
$('#today-button').addEventListener('click', () => {
  week = startOfWeek(new Date());
  renderCalendar();
});
$('#demo-button').addEventListener('click', () =>
  confirmAction(
    'Reload example assignments?',
    'Unpublished example assignments and their local plans will be replaced. Your own assignments and all published work blocks are kept.',
    async () => {
      await send('RESET_DEMO');
      week = startOfWeek(new Date());
      toast('Example assignments refreshed.');
    },
  ),
);
$('#confirm-action').addEventListener('click', (event) =>
  work(event.currentTarget, async () => {
    await confirmCallback?.();
    $('#confirm-dialog').close();
  }),
);
$('#plan-list').addEventListener('click', (event) => {
  if (!event.target.closest('#clear-local-plans')) return;
  confirmAction(
    'Clear unpublished work blocks?',
    'Published events stay on Google Calendar. Your assignment estimates stay here.',
    async () => {
      for (const task of state.tasks) await send('CLEAR_PLAN', { id: task.id });
      toast('Unpublished blocks cleared.');
    },
  );
});
function connectCalendar(event, fromSettings = false) {
  if (!isExtension || !configured) {
    openSettings(true);
    return;
  }
  work(
    event.currentTarget,
    async () => {
      await send('CONNECT');
      if (fromSettings) $('#settings-dialog').close();
      toast('Connected. Future plans will use your primary Google Calendar.');
    },
    fromSettings ? '#settings-error' : undefined,
  );
}
$('#connect-button').addEventListener('click', (event) => connectCalendar(event));
$('#settings-connect-button').addEventListener('click', (event) => connectCalendar(event, true));
$('#disconnect-button').addEventListener('click', (event) =>
  work(
    event.currentTarget,
    async () => {
      await send('DISCONNECT');
      $('#settings-dialog').close();
      toast('Disconnected. Published events remain on your calendar.');
    },
    '#settings-error',
  ),
);
$('#refresh-button').addEventListener('click', (event) =>
  work(event.currentTarget, async () => {
    await send('REFRESH_CALENDAR');
    toast('Calendar changes refreshed.');
  }),
);
$('#publish-button').addEventListener('click', () => {
  const pending = state.blocks.filter((b) => !b.googleEventId);
  publishingIds = pending.map((b) => b.id);
  $('#publish-list').innerHTML = pending
    .map(
      (b) =>
        `<div class="proposal-item"><div><strong>${escape(state.tasks.find((t) => t.id === b.taskId)?.title)}</strong><p>${escape(longDate(b.start))} · ${escape(timeLabel(b.start))}–${escape(timeLabel(b.end))}</p></div><span>${formatMinutes(blockDuration(b))}</span></div>`,
    )
    .join('');
  $('#confirm-publish').textContent =
    `Publish ${pending.length} work block${pending.length === 1 ? '' : 's'}`;
  $('#publish-error').hidden = true;
  $('#publish-dialog').showModal();
});
$('#confirm-publish').addEventListener('click', (event) =>
  work(
    event.currentTarget,
    async () => {
      await send('PUBLISH', { ids: publishingIds });
      $('#publish-dialog').close();
      toast('Your work blocks are now on Google Calendar.');
    },
    '#publish-error',
  ),
);
$('#expand-button').addEventListener('click', (event) => {
  if (isExtension) work(event.currentTarget, () => openGoogleCalendar());
  else window.open(GOOGLE_CALENDAR_URL, '_blank', 'noopener');
});
for (const dialog of document.querySelectorAll('dialog'))
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      dialog.close();
  });
for (let hour = 0; hour <= 23; hour++) {
  const label = `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
  $('#work-start').add(new Option(label, hour));
  $('#work-end').add(new Option(label, hour));
}
subscribe(() => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch((error) => toast(error.message, true)), 80);
});
await refresh()
  .then(() => {
    if (!state.profile?.onboardingComplete) openProfile(true);
  })
  .catch((error) => {
    toast(`WAC could not start: ${error.message}`, true);
  });
