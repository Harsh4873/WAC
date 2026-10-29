import { createController } from './controller.mjs';

export const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const KEY = 'wac-preview-v1';
const local = createController({
  load: async () => {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : null;
  },
  save: async (state) => localStorage.setItem(KEY, JSON.stringify(state)),
});
export async function send(type, payload = {}) {
  if (!isExtension) return local({ type, ...payload });
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok)
    throw new Error(
      response?.error || 'WAC could not complete this action. Reload the extension and try again.',
    );
  return response.data;
}
export function subscribe(callback) {
  if (isExtension)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.wacState) callback();
    });
  else
    window.addEventListener('storage', (event) => {
      if (event.key === KEY) callback();
    });
}
