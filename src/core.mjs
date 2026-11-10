import { profileFactor } from './profile.mjs';
import {
  validateAnalysisResult,
  attachmentMetadata,
  MAX_TEXT_LENGTH,
} from './analysis-contract.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  visualMode: 'patterns',
  workStart: 9,
  workEnd: 19,
  dailyLimit: 240,
  blockMinutes: 60,
  breakMinutes: 15,
  reminderCount: 1,
  weekends: true,
});
export const COURSES = [
  { name: 'CSCE 671', color: '#7060d0' },
  { name: 'CSCE 633', color: '#2c8e91' },
  { name: 'STAT 601', color: '#c17b35' },
  { name: 'Personal', color: '#5779bd' },
];
export const TYPES = {
  reading: { label: 'Reading + notes', unit: 'pages', defaultSize: 20, rate: 4, setup: 20 },
  writing: { label: 'Writing', unit: 'words', defaultSize: 1000, rate: 0.15, setup: 30 },
  coding: { label: 'Coding', unit: 'features', defaultSize: 2, rate: 60, setup: 30 },
  problems: { label: 'Problem set', unit: 'problems', defaultSize: 6, rate: 15, setup: 15 },
  project: { label: 'Project', unit: 'milestones', defaultSize: 3, rate: 60, setup: 30 },
};
export const uid = () => crypto.randomUUID();
export const round15 = (n) => Math.max(15, Math.ceil(n / 15) * 15);
export const tierFor = (n) => (n <= 60 ? 'low' : n <= 180 ? 'medium' : 'high');
export const tierTag = (tier) => ({ low: '+', medium: '++', high: '+++' })[tier] || '+';
export const tierLabel = (tier) => ({ low: 'Low', medium: 'Medium', high: 'High' })[tier] || 'Low';
export const SUBMISSION_TYPES = Object.freeze([
  { id: 'online_upload', label: 'File upload' },
  { id: 'online_text_entry', label: 'Text entry' },
  { id: 'online_quiz', label: 'Quiz' },
  { id: 'online_url', label: 'Website URL' },
  { id: 'discussion_topic', label: 'Discussion' },
  { id: 'on_paper', label: 'On paper' },
  { id: 'none', label: 'No submission' },
]);
export const submissionLabel = (id) => SUBMISSION_TYPES.find((item) => item.id === id)?.label || '';
export function dateFromKey(key) {
  const [year, month, day] = String(key || '')
    .split('-')
    .map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}
export const formatMinutes = (n) =>
  n < 60 ? `${n}m` : `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ''}`;
export const dayKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const localInput = (date) => {
  const d = new Date(date);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
export function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
export function atHour(date, hour) {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}
export function estimateTask({
  type = 'reading',
  size,
  familiarity = 'some',
  description = '',
  profile = null,
}) {
  const rule = TYPES[type];
  if (!rule) throw new Error('Choose a task type.');
  const quantity = Number(size == null || size === '' ? rule.defaultSize : size);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000)
    throw new Error('Enter a valid task size.');
  const factor = { familiar: 0.8, some: 1, new: 1.4 }[familiarity];
  if (!factor) throw new Error('Choose your familiarity with the topic.');
  const research = /research|literature|\u67e5\u8d44\u6599|\u6587\u732e/i.test(description)
    ? 30
    : 0;
  const personal = profileFactor(type, profile);
  const minutes = Math.min(
    2400,
    round15((rule.setup + quantity * rule.rate + research) * factor * personal),
  );
  return {
    minutes,
    low: round15(minutes * 0.8),
    high: Math.min(2880, round15(minutes * 1.3)),
    reason: `${quantity} ${quantity === 1 && rule.unit.endsWith('s') ? rule.unit.slice(0, -1) : rule.unit} × ${rule.rate} min, plus ${rule.setup} min to get started${research ? ', plus 30 min for research' : ''}${factor === 1 ? '' : `; familiarity × ${factor}`}${personal === 1 ? '' : `; your pace × ${personal}`}.`,
    source: 'Rule-based estimate · editable, not a measured prediction',
  };
}
export function validateTask(input, previous = null, profile = null) {
  const title = String(input.title || '')
    .trim()
    .slice(0, 160);
  if (!title) throw new Error('Give your assignment a title.');
  const due = new Date(input.due);
  if (!Number.isFinite(due.getTime())) throw new Error('Choose a valid deadline.');
  const type = input.type || 'reading';
  const description = String(input.description || '');
  if (description.length > MAX_TEXT_LENGTH)
    throw new Error(
      `Keep assignment instructions within ${MAX_TEXT_LENGTH.toLocaleString()} characters.`,
    );
  const familiarity = input.familiarity || 'some';
  const size = Number(
    input.size == null || input.size === '' ? TYPES[type]?.defaultSize : input.size,
  );
  const analysisInput = input.analysis === undefined ? previous?.analysis : input.analysis;
  const analysis = analysisInput
    ? {
        ...validateAnalysisResult(analysisInput),
        provider: ['gemini', 'demo'].includes(analysisInput.provider)
          ? analysisInput.provider
          : 'gemini',
        model: String(analysisInput.model || '').slice(0, 100),
        generatedAt: analysisInput.generatedAt || new Date().toISOString(),
      }
    : null;
  const estimate = analysis
    ? {
        minutes: analysis.estimate.minutes,
        low: analysis.estimate.lowMinutes,
        high: analysis.estimate.highMinutes,
        reason: analysis.reasons.join(' '),
        source:
          analysis.provider === 'demo'
            ? 'Demo analysis · no AI call made'
            : 'AI estimate · editable, not a measured prediction',
      }
    : estimateTask({ type, size, familiarity, description, profile });
  const minutes =
    input.estimateMinutes == null || input.estimateMinutes === ''
      ? estimate.minutes
      : Number(input.estimateMinutes);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 2400)
    throw new Error('Use an estimate between 15 and 2,400 minutes.');
  const effort = input.effort || tierFor(minutes);
  if (!['low', 'medium', 'high'].includes(effort)) throw new Error('Choose a valid effort level.');
  const course =
    String(input.course || 'Personal')
      .trim()
      .slice(0, 50) || 'Personal';
  const pointsPossible = readPoints(input, previous);
  const submissionTypes = readSubmissionTypes(input, previous);
  const reminderCount = readReminderCount(input, previous);
  return {
    ...previous,
    id: previous?.id || uid(),
    title,
    course,
    color: COURSES.find((c) => c.name === course)?.color || '#7060d0',
    due: due.toISOString(),
    type,
    description,
    size,
    familiarity,
    estimateMinutes: minutes,
    effort,
    pointsPossible,
    submissionTypes,
    reminderCount,
    estimate,
    analysis,
    attachment: attachmentMetadata(
      input.attachment === undefined ? previous?.attachment : input.attachment,
    ),
    source: previous?.source || 'manual',
    completed: previous?.completed || false,
    createdAt: previous?.createdAt || new Date().toISOString(),
  };
}
function readPoints(input, previous) {
  if (input.pointsPossible === undefined && input.points_possible === undefined)
    return previous?.pointsPossible ?? null;
  const raw = input.pointsPossible ?? input.points_possible;
  if (raw == null || raw === '') return null;
  const points = Number(raw);
  if (!Number.isFinite(points) || points < 0 || points > 100000)
    throw new Error('Enter points between 0 and 100,000, or leave points blank.');
  return Math.round(points * 100) / 100;
}
function readSubmissionTypes(input, previous) {
  if (input.submissionType === undefined && input.submissionTypes === undefined)
    return [...(previous?.submissionTypes || [])];
  const raw = input.submissionType !== undefined ? input.submissionType : input.submissionTypes;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (id == null || id === '') return [];
  if (!SUBMISSION_TYPES.some((item) => item.id === id))
    throw new Error('Choose a submission type from the list.');
  return [id];
}
function readReminderCount(input, previous) {
  const raw = input.taskReminderCount !== undefined ? input.taskReminderCount : input.reminderCount;
  if (raw === undefined) return previous?.reminderCount ?? null;
  if (raw == null || raw === '' || raw === 'default') return null;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0 || count > 5)
    throw new Error('Choose 0 to 5 reminders for this assignment, or use your default.');
  return count;
}
export function taskReminderCount(task, settings) {
  return Number.isInteger(task?.reminderCount) ? task.reminderCount : settings.reminderCount;
}
export function validateSettings(input, current = DEFAULT_SETTINGS) {
  const value = { ...current };
  for (const field of Object.keys(DEFAULT_SETTINGS))
    if (field in input) value[field] = input[field];
  if (!['off', 'tags', 'patterns'].includes(value.visualMode))
    throw new Error('Choose a display mode.');
  for (const [field, min, max] of [
    ['workStart', 0, 22],
    ['workEnd', 1, 23],
    ['dailyLimit', 30, 720],
    ['blockMinutes', 5, 240],
    ['breakMinutes', 0, 60],
    ['reminderCount', 0, 5],
  ]) {
    value[field] = Number(value[field]);
    if (!Number.isInteger(value[field]) || value[field] < min || value[field] > max)
      throw new Error(
        `Check ${
          {
            workStart: 'Workday starts',
            workEnd: 'Workday ends',
            dailyLimit: 'Daily WAC work limit',
            blockMinutes: 'Work block length',
            breakMinutes: 'Space between plans',
            reminderCount: 'Google reminders per block',
          }[field] || field
        }.`,
      );
  }
  if (value.workEnd <= value.workStart) throw new Error('Your workday must end after it starts.');
  if (value.dailyLimit < value.blockMinutes)
    throw new Error('Daily work limit must be at least one work block.');
  value.weekends = Boolean(value.weekends);
  return value;
}
export const blockDuration = (b) => Math.round((new Date(b.end) - new Date(b.start)) / 60000);
export const plannedMinutes = (taskId, blocks) =>
  blocks.filter((b) => b.taskId === taskId).reduce((sum, b) => sum + blockDuration(b), 0);
export const overlaps = (a, b, gap = 0) =>
  new Date(a.start).getTime() < new Date(b.end).getTime() + gap * 60000 &&
  new Date(a.end).getTime() + gap * 60000 > new Date(b.start).getTime();
export function normalizePlanOptions(input = {}, settings, remaining) {
  const blockMinutes = Number(input.blockMinutes ?? settings.blockMinutes);
  if (!Number.isInteger(blockMinutes) || blockMinutes < 5 || blockMinutes > 240)
    throw new Error('Choose a work-block length between 5 and 240 minutes.');
  const custom = input.customDurations ?? [];
  if (
    !Array.isArray(custom) ||
    custom.length > 480 ||
    custom.some((n) => !Number.isInteger(n) || n < 5 || n > 240)
  )
    throw new Error('Custom blocks must be whole minutes, each between 5 and 240.');
  if (custom.reduce((a, b) => a + b, 0) > remaining)
    throw new Error('Your custom blocks add up to more than the remaining task time.');
  return { blockMinutes, customDurations: [...custom] };
}
export function requestedDurations(remaining, options) {
  if (options.customDurations.length) return [...options.customDurations];
  const lengths = [];
  while (remaining > 0) {
    const duration = Math.min(options.blockMinutes, remaining);
    lengths.push(duration);
    remaining -= duration;
  }
  return lengths;
}
export function planTask(task, blocks, busy, settings, now = new Date(), inputOptions = {}) {
  let remaining = Math.max(0, task.estimateMinutes - plannedMinutes(task.id, blocks));
  const requestedMinutes = remaining;
  const options = normalizePlanOptions(inputOptions, settings, remaining);
  const lengths = requestedDurations(remaining, options);
  let next = 0;
  const proposal = [];
  const earliest = new Date(Math.ceil((now.getTime() + 15 * 60000) / 900000) * 900000);
  const horizon = addDays(now, 30);
  const last = Math.min(new Date(task.due).getTime(), horizon.getTime());
  const days = [];
  for (let day = atHour(now, 0); day.getTime() < last; day = addDays(day, 1)) {
    if (!settings.weekends && [0, 6].includes(day.getDay())) continue;
    days.push(new Date(day));
  }
  const dueKey = dayKey(task.due);
  // Sit the work on the open days just before it is due. Tomorrow is a last resort
  // when the deadline is close, and the due day is used only if earlier days cannot hold it.
  const ordered = [
    ...days.filter((day) => dayKey(day) !== dueKey).reverse(),
    ...days.filter((day) => dayKey(day) === dueKey),
  ];
  for (const day of ordered) {
    if (next >= lengths.length) break;
    let dailyUsed = blocks
      .filter((b) => dayKey(b.start) === dayKey(day))
      .reduce((s, b) => s + blockDuration(b), 0);
    let cursor = Math.max(atHour(day, settings.workStart).getTime(), earliest.getTime());
    const end = Math.min(atHour(day, settings.workEnd).getTime(), last);
    while (cursor + 5 * 60000 <= end && next < lengths.length && dailyUsed < settings.dailyLimit) {
      const duration = lengths[next];
      if (dailyUsed + duration > settings.dailyLimit) break;
      const candidate = {
        taskId: task.id,
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + duration * 60000).toISOString(),
      };
      const conflict = [...blocks, ...proposal, ...busy].some((b) =>
        overlaps(candidate, b, settings.breakMinutes),
      );
      if (new Date(candidate.end).getTime() <= end && !conflict) {
        proposal.push(candidate);
        remaining -= duration;
        dailyUsed += duration;
        next++;
        cursor += (duration + settings.breakMinutes) * 60000;
      } else cursor += 5 * 60000;
    }
  }
  return { blocks: proposal, unscheduledMinutes: remaining, requestedMinutes, options };
}
export function validatePlan(task, proposal, blocks, busy, settings, now = new Date()) {
  if (!Array.isArray(proposal) || !proposal.length || proposal.length > 480)
    throw new Error('Choose at least one valid work block.');
  let total = 0;
  const accepted = [];
  for (const raw of proposal) {
    const start = new Date(raw.start);
    const end = new Date(raw.end);
    const candidate = { taskId: task.id, start: start.toISOString(), end: end.toISOString() };
    const duration = blockDuration(candidate);
    if (!Number.isInteger(duration) || duration < 1 || duration > settings.blockMinutes)
      throw new Error('A work block must fit your block length setting.');
    if (start < now || end > new Date(task.due) || end <= start)
      throw new Error('Work blocks must be in the future and before the deadline.');
    if (
      dayKey(start) !== dayKey(end) ||
      start < atHour(start, settings.workStart) ||
      end > atHour(start, settings.workEnd)
    )
      throw new Error('Keep work blocks inside your work hours.');
    if (!settings.weekends && [0, 6].includes(start.getDay()))
      throw new Error('Weekend planning is turned off.');
    if (
      [...blocks, ...busy, ...accepted].some((b) => overlaps(candidate, b, settings.breakMinutes))
    )
      throw new Error('That time is already taken. The block stayed where it was.');
    const daily = [...blocks, ...accepted]
      .filter((b) => dayKey(b.start) === dayKey(start))
      .reduce((n, b) => n + blockDuration(b), duration);
    if (daily > settings.dailyLimit) throw new Error('This exceeds your daily WAC work limit.');
    total += duration;
    accepted.push(candidate);
  }
  if (total > task.estimateMinutes - plannedMinutes(task.id, blocks))
    throw new Error('Your estimate changed. Generate a new plan.');
  return accepted;
}
export function collisionDays(tasks, dailyLimit) {
  const groups = new Map();
  for (const task of tasks) {
    if (task.completed) continue;
    const key = dayKey(task.due);
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([day, items]) => ({
      day,
      tasks: items,
      minutes: items.reduce((sum, task) => sum + task.estimateMinutes, 0),
    }))
    .filter((group) => group.tasks.length > 1 && group.minutes > dailyLimit)
    .sort((a, b) => a.day.localeCompare(b.day));
}
export function relocateBlock(block, startIso, task, blocks, busy, settings, now = new Date()) {
  if (block.googleEventId)
    throw new Error('This block is on Google Calendar. Move it there, then refresh WAC.');
  const duration = blockDuration(block);
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) throw new Error('Choose a valid time.');
  const candidate = {
    taskId: task.id,
    start: start.toISOString(),
    end: new Date(start.getTime() + duration * 60000).toISOString(),
  };
  const others = blocks.filter((item) => item.id !== block.id);
  const accepted = validatePlan(
    task,
    [candidate],
    others,
    busy,
    { ...settings, blockMinutes: Math.max(settings.blockMinutes, duration) },
    now,
  );
  return accepted[0];
}
export function earlierSlot(block, task, blocks, busy, settings, now = new Date()) {
  if (block.googleEventId)
    throw new Error('This block is on Google Calendar. Move it there, then refresh WAC.');
  const duration = blockDuration(block);
  let cursor = new Date(new Date(block.start).getTime() - 15 * 60000);
  const limit = addDays(new Date(block.start), -21);
  const earliest = new Date(now.getTime() + 15 * 60000);
  while (cursor > limit && cursor > earliest) {
    const minutes = cursor.getHours() * 60 + cursor.getMinutes();
    const weekend = !settings.weekends && [0, 6].includes(cursor.getDay());
    const insideHours =
      minutes >= settings.workStart * 60 && minutes + duration <= settings.workEnd * 60;
    if (!weekend && insideHours) {
      try {
        return relocateBlock(block, cursor.toISOString(), task, blocks, busy, settings, now);
      } catch {
        // Keep walking back until a free work-hour slot appears.
      }
    }
    cursor = new Date(cursor.getTime() - 15 * 60000);
  }
  throw new Error('No earlier open time before this block, inside your work hours.');
}
export const DEMO_REVISION = 'phase6-canvas';
const LEGACY_DEMO_OFFSETS = {
  'literature-review': 2,
  'neural-network-lab': 3,
  'probability-problem-set': 3,
  'prototype-walkthrough': 5,
};
export function demoTasks() {
  const due = (day) => new Date(2026, 11, day, 23, 0, 0, 0).toISOString();
  return [
    {
      demoKey: 'literature-review',
      title: 'Literature review',
      course: 'CSCE 671',
      type: 'reading',
      size: 24,
      due: due(7),
      pointsPossible: 100,
      submissionTypes: ['online_text_entry'],
      description: 'Read two papers and prepare research notes for our HCI project.',
      estimateMinutes: 180,
    },
    {
      demoKey: 'neural-network-lab',
      title: 'Neural network lab',
      course: 'CSCE 633',
      type: 'coding',
      size: 3,
      due: due(10),
      pointsPossible: 50,
      submissionTypes: ['online_upload'],
      description: 'Implement the training loop, evaluate the model, and write up findings.',
      estimateMinutes: 240,
    },
    {
      demoKey: 'probability-problem-set',
      title: 'Probability problem set',
      course: 'STAT 601',
      type: 'problems',
      size: 6,
      due: due(10),
      pointsPossible: 40,
      submissionTypes: ['online_quiz'],
      description: 'Six problems covering conditional probability and distributions.',
      estimateMinutes: 105,
    },
    {
      demoKey: 'prototype-walkthrough',
      title: 'Prototype walkthrough',
      course: 'CSCE 671',
      type: 'writing',
      size: 500,
      due: due(14),
      pointsPossible: 25,
      submissionTypes: ['online_upload'],
      description: 'Prepare a concise walkthrough of the workload-aware calendar.',
      estimateMinutes: 90,
    },
  ].map((t) => ({
    ...validateTask({ ...t, familiarity: 'some' }),
    source: 'demo',
    demoKey: t.demoKey,
    demoOriginalDue: t.due,
  }));
}
export function refreshDemoExamples(state) {
  if (state.demoRevision === DEMO_REVISION) return false;
  const published = new Set(state.blocks.filter((b) => b.googleEventId).map((b) => b.taskId));
  const templates = demoTasks();
  const refreshed = new Set();
  const anchor = new Date(state.demoAnchor);
  const defaultFields = [
    'title',
    'course',
    'type',
    'size',
    'description',
    'familiarity',
    'estimateMinutes',
    'effort',
  ];
  for (const task of state.tasks) {
    if (
      task.source !== 'demo' ||
      task.completed ||
      task.analysis ||
      task.attachment ||
      published.has(task.id)
    )
      continue;
    const template = templates.find((sample) =>
      defaultFields.every((key) => task[key] === sample[key]),
    );
    if (!template) continue;
    const originalDue =
      task.demoOriginalDue ||
      (Number.isFinite(anchor.getTime())
        ? atHour(addDays(anchor, LEGACY_DEMO_OFFSETS[template.demoKey]), 23).toISOString()
        : null);
    // Only refresh untouched examples; a user-edited deadline must stay unchanged.
    if (task.due !== originalDue) continue;
    task.due = template.due;
    task.demoKey = template.demoKey;
    task.demoOriginalDue = template.due;
    task.pointsPossible = template.pointsPossible;
    task.submissionTypes = [...template.submissionTypes];
    task.reminderCount = template.reminderCount ?? null;
    refreshed.add(task.id);
  }
  state.blocks = state.blocks.filter((b) => b.googleEventId || !refreshed.has(b.taskId));
  state.demoRevision = DEMO_REVISION;
  return true;
}
export function demoBusy(now = new Date()) {
  const events = [];
  const monday = startOfWeek(now);
  for (let week = 0; week < 5; week++)
    for (const [day, hour, duration, title] of [
      [0, 10, 75, 'HCI seminar'],
      [1, 14, 90, 'Machine learning'],
      [2, 10, 75, 'HCI seminar'],
      [3, 14, 90, 'Machine learning'],
      [4, 11, 60, 'Study group'],
    ]) {
      const start = atHour(addDays(monday, week * 7 + day), hour);
      events.push({
        id: `demo-class-${week}-${day}`,
        title,
        start: start.toISOString(),
        end: new Date(start.getTime() + duration * 60000).toISOString(),
        demo: true,
      });
    }
  return events;
}
export function initialState(now = new Date()) {
  return {
    version: 1,
    instanceId: uid(),
    profile: null,
    tasks: demoTasks(),
    blocks: [],
    settings: { ...DEFAULT_SETTINGS },
    google: { connected: false },
    calendarEvents: [],
    demoAnchor: now.toISOString(),
    demoRevision: DEMO_REVISION,
  };
}
