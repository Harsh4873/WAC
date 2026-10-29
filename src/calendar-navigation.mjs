export const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/';

export async function openGoogleCalendar(chromeApi = globalThis.chrome) {
  // Keep the user's account, date, and view when Calendar is already open.
  // Staying in this window also keeps the global WAC side panel alongside it.
  const tabs = await chromeApi.tabs.query({
    url: 'https://calendar.google.com/*',
    currentWindow: true,
  });
  const existing =
    tabs.find((tab) => tab.active) ||
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  if (existing) return chromeApi.tabs.update(existing.id, { active: true });
  return chromeApi.tabs.create({ url: GOOGLE_CALENDAR_URL, active: true });
}
