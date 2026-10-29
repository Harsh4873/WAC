import { validateProfile } from './profile.mjs';
export const MAX_TEXT_LENGTH = 60000;
export const MAX_FILE_BYTES = 6 * 1024 * 1024;
const TYPES = ['reading', 'writing', 'coding', 'problems', 'project'];
const LEVELS = ['low', 'medium', 'high'];
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error(`Invalid ${label}.`);
  return value.trim();
}
function minutes(value, label, min = 5, max = 2400) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
  return value;
}
function lines(value, label) {
  if (!Array.isArray(value) || value.length > 12) throw new Error(`Invalid ${label}.`);
  return value.map((item) => text(item, 600, label, true));
}
export function attachmentMetadata(input) {
  if (!input) return null;
  const name = text(input.name, 180, 'file name', true);
  const mimeType = input.mimeType;
  if (!['application/pdf', 'text/plain', 'text/markdown'].includes(mimeType))
    throw new Error('Choose a PDF, TXT, or Markdown file.');
  const size = minutes(input.size, 'file size', 1, MAX_FILE_BYTES);
  return { name, mimeType, size };
}
export function validateAnalysisInput(input) {
  if (!input || typeof input !== 'object') throw new Error('An assignment is required.');
  const description = text(input.text ?? '', MAX_TEXT_LENGTH, 'assignment text');
  let attachment = null;
  if (input.attachment) {
    const meta = attachmentMetadata(input.attachment);
    if (meta.mimeType !== 'application/pdf')
      throw new Error('Text files must be included as assignment text.');
    const data = input.attachment.data;
    if (
      typeof data !== 'string' ||
      data.length % 4 !== 0 ||
      data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      throw new Error('Invalid PDF content.');
    const binary =
      typeof Buffer !== 'undefined'
        ? Buffer.from(data, 'base64')
        : Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    if (
      binary.length !== meta.size ||
      binary.length < 5 ||
      String.fromCharCode(...binary.slice(0, 5)) !== '%PDF-'
    )
      throw new Error('The selected file is not a valid PDF.');
    attachment = { ...meta, data };
  }
  if (!description && !attachment)
    throw new Error('Paste assignment instructions or attach a PDF first.');
  const hint = input.task || {};
  const type = hint.type || 'project';
  if (!TYPES.includes(type)) throw new Error('Choose a valid task type.');
  const familiarity = hint.familiarity || 'some';
  if (!['new', 'some', 'familiar'].includes(familiarity))
    throw new Error('Choose your familiarity with this assignment.');
  const timeZone = text(input.timeZone || 'UTC', 100, 'time zone', true);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error('Invalid time zone.');
  }
  return {
    schemaVersion: 1,
    text: description,
    attachment,
    profile: validateProfile(input.profile || {}),
    task: {
      title: text(hint.title || '', 160, 'task title'),
      course: text(hint.course || '', 50, 'course'),
      type,
      familiarity,
    },
    timeZone,
  };
}
export function validateAnalysisResult(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('The analysis service returned an invalid result.');
  const title = text(raw.title, 160, 'analysis title', true);
  if (!TYPES.includes(raw.type)) throw new Error('The analysis returned an unknown task type.');
  if (!LEVELS.includes(raw.complexity))
    throw new Error('The analysis returned an invalid complexity level.');
  const estimate = raw.estimate || {};
  const total = minutes(estimate.minutes, 'estimated effort', 15);
  const low = minutes(estimate.lowMinutes, 'lower estimate', 5, 2880);
  const high = minutes(estimate.highMinutes, 'upper estimate', 15, 2880);
  if (low > total || high < total) throw new Error('The estimated time range is inconsistent.');
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 30)
    throw new Error('The analysis must include a task breakdown.');
  const steps = raw.steps.map((step) => ({
    title: text(step.title, 160, 'step title', true),
    minutes: minutes(step.minutes, 'step effort'),
  }));
  if (steps.reduce((n, s) => n + s.minutes, 0) !== total)
    throw new Error(
      'The suggested steps do not add up to the total estimate. Please analyze again.',
    );
  let deadline = null;
  if (raw.deadline != null) {
    if (
      typeof raw.deadline !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(raw.deadline) ||
      !Number.isFinite(new Date(raw.deadline).getTime())
    )
      throw new Error('The analysis returned an invalid deadline.');
    deadline = new Date(raw.deadline).toISOString();
  }
  return {
    title,
    type: raw.type,
    complexity: raw.complexity,
    deadline,
    summary: text(raw.summary, 1200, 'analysis summary', true),
    estimate: { minutes: total, lowMinutes: low, highMinutes: high },
    steps,
    reasons: lines(raw.reasons, 'complexity reasons'),
    assumptions: lines(raw.assumptions, 'assumptions'),
    questions: lines(raw.questions, 'follow-up questions'),
    suggestedBlockMinutes: minutes(raw.suggestedBlockMinutes, 'suggested block length', 5, 240),
  };
}
export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: TYPES },
    complexity: { type: 'string', enum: LEVELS },
    deadline: { type: ['string', 'null'] },
    summary: { type: 'string' },
    estimate: {
      type: 'object',
      properties: {
        minutes: { type: 'integer' },
        lowMinutes: { type: 'integer' },
        highMinutes: { type: 'integer' },
      },
      required: ['minutes', 'lowMinutes', 'highMinutes'],
      additionalProperties: false,
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, minutes: { type: 'integer' } },
        required: ['title', 'minutes'],
        additionalProperties: false,
      },
    },
    reasons: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    suggestedBlockMinutes: { type: 'integer' },
  },
  required: [
    'title',
    'type',
    'complexity',
    'deadline',
    'summary',
    'estimate',
    'steps',
    'reasons',
    'assumptions',
    'questions',
    'suggestedBlockMinutes',
  ],
};
