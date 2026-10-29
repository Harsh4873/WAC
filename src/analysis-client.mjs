import { validateAnalysisInput, validateAnalysisResult } from './analysis-contract.mjs';

export async function analyzeAssignment(input, { signal, fetcher = fetch } = {}) {
  const payload = validateAnalysisInput(input);
  const configResponse = await fetcher(new URL('../analysis.config.json', import.meta.url), {
    signal,
  });
  if (!configResponse.ok)
    throw new Error(
      'The analysis service has not been set up yet. You can still enter your own estimate.',
    );
  const config = await configResponse.json();
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new Error('The analysis service address is invalid. Ask your project team to check it.');
  }
  if (
    endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))
  )
    throw new Error('The analysis service requires a secure connection.');
  let response;
  try {
    response = await fetcher(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(70000)]),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'The analysis service is unavailable. You can keep the attachment and save with your own estimate.',
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      body.error?.message || 'The assignment could not be analyzed. Please try again.',
    );
  if (!['gemini', 'demo'].includes(body.provider))
    throw new Error('The analysis service returned an unknown result source.');
  return {
    ...validateAnalysisResult(body.analysis),
    provider: body.provider,
    model: String(body.model || '').slice(0, 100),
    generatedAt: body.generatedAt || new Date().toISOString(),
  };
}
