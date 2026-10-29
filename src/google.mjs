const ROOT = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];
export { SCOPES };

export function createGoogleClient(chromeApi = globalThis.chrome, fetcher = fetch) {
  function configured() {
    return Boolean(chromeApi?.runtime?.getManifest().oauth2?.client_id);
  }
  async function token(interactive = false) {
    if (!configured())
      throw new Error(
        'Google connection needs your OAuth Client ID. Open Settings for the setup steps.',
      );
    const result = await chromeApi.identity.getAuthToken({
      interactive,
      scopes: SCOPES,
      enableGranularPermissions: true,
    });
    if (!result?.token) throw new Error('Google sign-in did not return an access token.');
    return result.token;
  }
  async function request(path, { method = 'GET', body, retry = true, allowMissing = false } = {}) {
    const auth = await token();
    const response = await fetcher(`${ROOT}${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25000),
    });
    if (response.status === 401 && retry) {
      await chromeApi.identity.removeCachedAuthToken({ token: auth });
      return request(path, { method, body, retry: false, allowMissing });
    }
    if (allowMissing && [404, 410].includes(response.status)) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        `Google Calendar: ${data.error?.message || `request failed (${response.status})`}`,
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function busy(start, end) {
    const data = await request('/freeBusy', {
      method: 'POST',
      body: { timeMin: start, timeMax: end, items: [{ id: 'primary' }] },
    });
    const calendar = data.calendars?.primary;
    if (!calendar || calendar.errors?.length)
      throw new Error('Could not check your primary calendar. No plan was created.');
    return calendar.busy || [];
  }
  async function events(start, end) {
    const output = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        timeMin: start,
        timeMax: end,
        singleEvents: 'true',
        maxResults: '2500',
        orderBy: 'startTime',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await request(`/calendars/primary/events?${params}`);
      for (const e of data.items || []) {
        if (
          e.status === 'cancelled' ||
          e.attendees?.some((a) => a.self && a.responseStatus === 'declined')
        )
          continue;
        output.push({
          id: e.id,
          title: e.summary || '(Untitled)',
          start: e.start?.dateTime || `${e.start?.date}T00:00:00`,
          end: e.end?.dateTime || `${e.end?.date}T00:00:00`,
          allDay: !e.start?.dateTime,
          wac: Boolean(e.extendedProperties?.private?.wacBlockId),
          htmlLink: e.htmlLink,
        });
      }
      pageToken = data.nextPageToken;
      if (output.length > 10000)
        throw new Error('Too many calendar events to display. Try a calendar with fewer events.');
    } while (pageToken);
    return output;
  }
  async function eventId(block, instanceId) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`wac-v1:${instanceId}:${block.id}`),
    );
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function recoverBlock(block, instanceId) {
    const id = await eventId(block, instanceId);
    const existing = await request(`/calendars/primary/events/${id}`, { allowMissing: true });
    if (!existing) return null;
    if (existing.status === 'cancelled') return { deleted: true };
    if (
      existing.extendedProperties?.private?.wacBlockId !== block.id ||
      existing.extendedProperties?.private?.wacInstanceId !== instanceId
    )
      throw new Error('Calendar event identifier conflict. Nothing was overwritten.');
    return existing;
  }
  async function createBlock(block, task, instanceId, reminderCount) {
    const id = await eventId(block, instanceId);
    const summary = `WAC · ${task.course} · ${task.title}`;
    const resource = {
      id,
      summary,
      description: `Work block for: ${task.title}\nDeadline: ${new Date(task.due).toLocaleString()}\nEstimated effort: ${task.estimateMinutes} minutes (${task.effort}).\nCreated by Workload Aware Calendar.`,
      start: { dateTime: block.start },
      end: { dateTime: block.end },
      transparency: 'opaque',
      extendedProperties: {
        private: { wacBlockId: block.id, wacTaskId: task.id, wacInstanceId: instanceId },
      },
      reminders: {
        useDefault: false,
        overrides: [10, 30, 60, 1440, 2880]
          .slice(0, reminderCount)
          .map((minutes) => ({ method: 'popup', minutes })),
      },
    };
    try {
      return await request('/calendars/primary/events?sendUpdates=none', {
        method: 'POST',
        body: resource,
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      const existing = await request(`/calendars/primary/events/${id}`);
      if (existing.status === 'cancelled')
        throw new Error(
          'This work block was deleted in Google Calendar. Refresh your calendar before replanning.',
        );
      if (
        existing.extendedProperties?.private?.wacBlockId !== block.id ||
        existing.extendedProperties?.private?.wacInstanceId !== instanceId
      )
        throw new Error('Calendar event identifier conflict. Nothing was overwritten.');
      return existing;
    }
  }
  return {
    configured,
    request,
    busy,
    events,
    createBlock,
    recoverBlock,
    connect: () => token(true),
    disconnect: () => chromeApi.identity.clearAllCachedAuthTokens(),
    getBlock: (id) =>
      request(`/calendars/primary/events/${encodeURIComponent(id)}`, { allowMissing: true }),
  };
}
