import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile } from '../src/profile.mjs';
import {
  validateAnalysisInput,
  validateAnalysisResult,
  MAX_TEXT_LENGTH,
} from '../src/analysis-contract.mjs';
import { createAnalysisHandler } from '../backend/handler.mjs';
import { generateGeminiAnalysis } from '../backend/gemini.mjs';
import { validateTask, estimateTask } from '../src/core.mjs';

const draft = () => ({
  title: 'History essay',
  type: 'writing',
  complexity: 'medium',
  deadline: null,
  summary: 'Compare two historical sources and write an argument.',
  estimate: { minutes: 120, lowMinutes: 90, highMinutes: 180 },
  steps: [
    { title: 'Review sources', minutes: 30 },
    { title: 'Write the argument', minutes: 60 },
    { title: 'Revise', minutes: 30 },
  ],
  reasons: ['Requires comparison and a supported argument.'],
  assumptions: ['Sources are available.'],
  questions: ['What is the deadline?'],
  suggestedBlockMinutes: 25,
});
const input = (extra) => ({
  text: 'Compare two historical sources and write an essay.',
  profile: {
    fieldOfStudy: 'History',
    stage: 'undergraduate',
    familiarTopics: 'Close reading',
    developingTopics: 'Archival research',
    preferredBlockMinutes: 25,
  },
  task: { title: 'History essay', type: 'writing', familiarity: 'some' },
  timeZone: 'America/Chicago',
  ...extra,
});
const request = (body, origin = 'chrome-extension://test') =>
  new Request('http://127.0.0.1:8787/v1/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
const configured = { GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'test-model' };
const options = { allowedOrigins: ['chrome-extension://test'] };

test('profile works for non-CS users, is optional, and rejects invalid preferences', () => {
  const profile = validateProfile({
    fieldOfStudy: 'Nursing',
    familiarTopics: 'Clinical practice',
    preferredBlockMinutes: 25,
  });
  assert.equal(profile.fieldOfStudy, 'Nursing');
  assert.equal(profile.preferredBlockMinutes, 25);
  assert.equal(validateProfile().stage, 'unspecified');
  assert.throws(() => validateProfile({ preferredBlockMinutes: 0 }));
  assert.throws(() => validateProfile({ readingPace: 'guess' }));
  const slow = estimateTask({
    type: 'reading',
    size: 20,
    profile: validateProfile({ readingPace: 'slower' }),
  });
  const fast = estimateTask({
    type: 'reading',
    size: 20,
    profile: validateProfile({ readingPace: 'faster' }),
  });
  assert.ok(slow.minutes > fast.minutes);
});
test('accepts long text and PDF input while stripping unrelated profile fields', () => {
  const text = 'Read and analyze. '.repeat(2500);
  assert.ok(validateAnalysisInput(input({ text })).text.length > 5000);
  const bytes = Buffer.from('%PDF-1.4\nfixture');
  const pdf = validateAnalysisInput(
    input({
      text: '',
      attachment: {
        name: 'assignment.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
        data: bytes.toString('base64'),
      },
    }),
  );
  assert.equal(pdf.attachment.size, bytes.length);
  assert.equal(
    validateAnalysisInput(
      input({ profile: { ...input().profile, googleToken: 'never-forward-this' } }),
    ).profile.googleToken,
    undefined,
  );
  assert.throws(() => validateAnalysisInput(input({ text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })));
  assert.throws(() => validateAnalysisInput(input({ text: '', attachment: null })));
  assert.throws(() =>
    validateAnalysisInput(
      input({
        attachment: {
          name: 'bad.pdf',
          mimeType: 'application/pdf',
          size: 5,
          data: Buffer.from('wrong').toString('base64'),
        },
      }),
    ),
  );
});
test('rejects invalid estimates and fabricated date formats before saving a draft', () => {
  assert.equal(validateAnalysisResult(draft()).deadline, null);
  assert.throws(
    () =>
      validateAnalysisResult({
        ...draft(),
        estimate: { minutes: 121, lowMinutes: 90, highMinutes: 180 },
      }),
    /add up/,
  );
  assert.throws(() => validateAnalysisResult({ ...draft(), deadline: 'Friday' }), /deadline/);
  assert.throws(() => validateAnalysisResult({ ...draft(), complexity: 'genius' }));
});
test('saves the AI draft, long instructions and file metadata without original file bytes', () => {
  const result = draft();
  const task = validateTask({
    title: result.title,
    type: result.type,
    size: 500,
    due: '2026-12-01T23:00:00Z',
    description: 'Assignment text. '.repeat(2000),
    analysis: { ...result, provider: 'gemini' },
    attachment: {
      name: 'instructions.pdf',
      mimeType: 'application/pdf',
      size: 100,
      data: 'not-stored',
    },
  });
  assert.equal(task.estimateMinutes, 120);
  assert.equal(task.analysis.complexity, 'medium');
  assert.equal(task.attachment.data, undefined);
  assert.ok(task.description.length > 5000);
  const edited = validateTask({ ...task, estimateMinutes: 150 }, task);
  assert.equal(edited.estimateMinutes, 150);
  assert.equal(edited.analysis.estimate.minutes, 120);
});
test('unconfigured service responds without contacting a paid model', async () => {
  let calls = 0;
  const handler = createAnalysisHandler({
    ...options,
    env: {},
    generate: async () => {
      calls++;
      return draft();
    },
  });
  const response = await handler(request(input()));
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error.code, 'AI_NOT_CONFIGURED');
});
test('API validates origin, body shape, and content type before model access', async () => {
  let calls = 0;
  const handler = createAnalysisHandler({
    ...options,
    env: configured,
    generate: async () => {
      calls++;
      return draft();
    },
  });
  assert.equal((await handler(request(input(), 'https://unrelated.example'))).status, 403);
  assert.equal((await handler(request(input({ text: '' })))).status, 400);
  assert.equal(
    (
      await handler(
        new Request('http://127.0.0.1/v1/analyze', { method: 'POST', body: 'not-json' }),
      )
    ).status,
    415,
  );
  const preflight = await handler(
    new Request('http://127.0.0.1/v1/analyze', {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://test' },
    }),
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'chrome-extension://test');
  assert.equal(calls, 0);
});
test('deduplicates simultaneous requests and reuses results without extra model cost', async () => {
  let calls = 0;
  let resolve;
  const handler = createAnalysisHandler({
    ...options,
    env: configured,
    generate: async () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  const a = handler(request(input()));
  const b = handler(request(input()));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  resolve(draft());
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
  const cached = await handler(request(input()));
  assert.equal((await cached.json()).cached, true);
  assert.equal(calls, 1);
});
test('profile changes invalidate the cache and usage limits prevent more model calls', async () => {
  let calls = 0;
  const handler = createAnalysisHandler({
    ...options,
    env: { ...configured, WAC_ANALYSIS_HOURLY_LIMIT: '2' },
    generate: async () => {
      calls++;
      return draft();
    },
  });
  assert.equal((await handler(request(input()))).status, 200);
  assert.equal(
    (await handler(request(input({ profile: { fieldOfStudy: 'Art history' } })))).status,
    200,
  );
  assert.equal(
    (await handler(request(input({ text: 'A third distinct assignment' })))).status,
    429,
  );
  assert.equal(calls, 2);
});
test('demo mode explicitly labels fixed results and never calls a model', async () => {
  let calls = 0;
  const handler = createAnalysisHandler({
    ...options,
    env: { WAC_ANALYSIS_MODE: 'demo' },
    generate: async () => {
      calls++;
      return draft();
    },
  });
  const response = await handler(request(input()));
  const body = await response.json();
  assert.equal(body.provider, 'demo');
  assert.equal(calls, 0);
  assert.match(body.analysis.summary, /No AI service was called/);
});
test('Gemini adapter sends schema, profile and PDF without putting the key in the URL', async () => {
  const bytes = Buffer.from('%PDF-1.4 fixture');
  const payload = validateAnalysisInput(
    input({
      attachment: {
        name: 'history.pdf',
        mimeType: 'application/pdf',
        size: bytes.length,
        data: bytes.toString('base64'),
      },
    }),
  );
  let captured;
  const analysis = await generateGeminiAnalysis(payload, {
    apiKey: 'test-only-key',
    model: 'test-model',
    fetcher: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft()) }] } },
          ],
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(analysis.complexity, 'medium');
  assert.ok(!captured.url.includes('test-only-key'));
  assert.equal(captured.init.headers['x-goog-api-key'], 'test-only-key');
  assert.match(captured.body.contents[0].parts[0].text, /History/);
  assert.equal(captured.body.contents[0].parts[2].inlineData.mimeType, 'application/pdf');
  assert.equal(captured.body.generationConfig.responseMimeType, 'application/json');
});
test('Gemini errors do not expose upstream credentials or silently produce a fake result', async () => {
  await assert.rejects(
    generateGeminiAnalysis(validateAnalysisInput(input()), {
      ...configured,
      apiKey: 'secret-key',
      model: 'test-model',
      fetcher: async () => new Response('secret-key was rejected', { status: 403 }),
    }),
    (error) => error.code === 'AI_PROVIDER_ERROR' && !error.message.includes('secret-key'),
  );
  await assert.rejects(
    generateGeminiAnalysis(validateAnalysisInput(input()), {
      apiKey: 'test',
      model: 'test-model',
      fetcher: async () =>
        new Response(
          JSON.stringify({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }],
          }),
        ),
    }),
    /inconsistent/,
  );
});
