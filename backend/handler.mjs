import { createHash, randomUUID } from 'node:crypto';
import { validateAnalysisInput, validateAnalysisResult } from '../src/analysis-contract.mjs';
import { generateGeminiAnalysis } from './gemini.mjs';

export const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
export function createAnalysisHandler({
  env = process.env,
  fetcher = fetch,
  allowedOrigins = [],
  now = () => Date.now(),
  generate = generateGeminiAnalysis,
} = {}) {
  const cache = new Map(),
    inflight = new Map(),
    calls = new Map();
  const mode = env.WAC_ANALYSIS_MODE === 'demo' ? 'demo' : 'gemini';
  const configured = mode === 'demo' || Boolean(env.GEMINI_API_KEY && env.GEMINI_MODEL);
  const limit = Math.max(1, Math.min(500, Number(env.WAC_ANALYSIS_HOURLY_LIMIT) || 30));
  const json = (body, status, origin) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      },
    });
  return async function handle(request, { clientId = 'local' } = {}) {
    const origin = request.headers.get('origin');
    if (origin && !allowedOrigins.includes(origin))
      return json(
        {
          error: {
            code: 'ORIGIN_NOT_ALLOWED',
            message: 'This application is not allowed to use the analysis service.',
          },
        },
        403,
        null,
      );
    const path = new URL(request.url).pathname;
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        },
      });
    }
    if (path === '/health' && request.method === 'GET')
      return json(
        {
          schemaVersion: 1,
          status: configured ? (mode === 'demo' ? 'demo' : 'ready') : 'not_configured',
        },
        200,
        origin,
      );
    if (path !== '/v1/analyze')
      return json(
        { error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } },
        404,
        origin,
      );
    if (request.method !== 'POST')
      return json(
        { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to analyze an assignment.' } },
        405,
        origin,
      );
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return json(
        { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send the assignment as JSON.' } },
        415,
        origin,
      );
    if (!configured)
      return json(
        {
          error: {
            code: 'AI_NOT_CONFIGURED',
            message:
              'AI analysis is not connected yet. You can still attach a file and enter your own estimate.',
          },
        },
        503,
        origin,
      );
    let input;
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES)
        return json(
          { error: { code: 'PAYLOAD_TOO_LARGE', message: 'This upload is too large.' } },
          413,
          origin,
        );
      input = validateAnalysisInput(JSON.parse(raw));
    } catch (error) {
      return json(
        {
          error: {
            code: 'INVALID_ASSIGNMENT',
            message:
              error instanceof SyntaxError
                ? 'The assignment request is not valid JSON.'
                : error.message,
          },
        },
        400,
        origin,
      );
    }
    for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key);
    for (const [key, entry] of calls) if (entry.expires <= now()) calls.delete(key);
    // Cache by source + profile + calendar date so relative-date instructions do not survive midnight.
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: input.timeZone,
      dateStyle: 'short',
    }).format(new Date(now()));
    const key = createHash('sha256')
      .update(JSON.stringify({ mode, model: env.GEMINI_MODEL, input, localDate }))
      .digest('hex');
    if (cache.has(key))
      return json({ ...cache.get(key).result, cached: true, requestId: randomUUID() }, 200, origin);
    if (!inflight.has(key)) {
      const bucket = calls.get(clientId) || { count: 0, expires: now() + 3600000 };
      if (bucket.count >= limit || inflight.size >= 2)
        return json(
          {
            error: {
              code: 'ANALYSIS_LIMIT',
              message:
                'The analysis service is busy or has reached its hourly limit. Please try again later.',
            },
          },
          429,
          origin,
        );
      bucket.count++;
      calls.set(clientId, bucket);
      const pending = (async () => {
        const analysis =
          mode === 'demo'
            ? validateAnalysisResult({
                title: input.task.title || 'Assignment draft',
                type: input.task.type,
                complexity: 'medium',
                deadline: null,
                summary: 'Sample suggestion. No AI service was called.',
                estimate: { minutes: 120, lowMinutes: 90, highMinutes: 180 },
                steps: [
                  { title: 'Review the requirements', minutes: 30 },
                  { title: 'Complete the main work', minutes: 60 },
                  { title: 'Review and revise', minutes: 30 },
                ],
                reasons: [
                  'Sample suggestion. No model was used. Keep your own deadline and estimate.',
                ],
                assumptions: ['Replace this estimate with your own judgment.'],
                questions: [],
                suggestedBlockMinutes: input.profile.preferredBlockMinutes,
              })
            : await generate(input, {
                apiKey: env.GEMINI_API_KEY,
                model: env.GEMINI_MODEL,
                fetcher,
                signal: request.signal,
              });
        const result = {
          schemaVersion: 1,
          provider: mode === 'demo' ? 'demo' : 'gemini',
          model: mode === 'demo' ? 'demo-fixture' : env.GEMINI_MODEL,
          generatedAt: new Date(now()).toISOString(),
          analysis: validateAnalysisResult(analysis),
        };
        if (cache.size >= 30) cache.delete(cache.keys().next().value);
        cache.set(key, { result, expires: now() + 600000 });
        return result;
      })();
      inflight.set(key, pending);
      pending.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
    }
    try {
      return json(
        { ...(await inflight.get(key)), cached: false, requestId: randomUUID() },
        200,
        origin,
      );
    } catch (error) {
      return json(
        {
          error: {
            code: error.code || 'ANALYSIS_FAILED',
            message: error.status
              ? error.message
              : 'The assignment could not be analyzed. Please try again.',
          },
        },
        error.status || 502,
        origin,
      );
    }
  };
}
