import { createController } from './controller.mjs';
import { createGoogleClient } from './google.mjs';

const execute = createController({
  load: async () => (await chrome.storage.local.get('wacState')).wacState,
  save: (state) => chrome.storage.local.set({ wacState: state }),
  google: createGoogleClient(),
});
const setPanelBehavior = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(setPanelBehavior);
chrome.runtime.onStartup.addListener(setPanelBehavior);
setPanelBehavior();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  // Calendar page scripts only receive the minimal styling index; only extension pages can mutate data.
  if (
    sender.tab &&
    !sender.url?.startsWith(chrome.runtime.getURL('')) &&
    message?.type !== 'GET_CONTENT_STATE'
  ) {
    respond({ ok: false, error: 'This action is only available inside WAC.' });
    return;
  }
  execute(message).then(
    (data) => respond({ ok: true, data }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});
