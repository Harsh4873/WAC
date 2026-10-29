import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleClient } from '../src/google.mjs';
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(fetcher, configured = true) {
  let tokens = 0,
    removals = 0;
  const chrome = {
    runtime: {
      getManifest: () =>
        configured ? { oauth2: { client_id: 'test.apps.googleusercontent.com' } } : {},
    },
    identity: {
      getAuthToken: async () => ({ token: `test-token-${++tokens}` }),
      removeCachedAuthToken: async () => {
        removals++;
      },
      clearAllCachedAuthTokens: async () => {},
    },
  };
  return { client: createGoogleClient(chrome, fetcher), counts: () => ({ tokens, removals }) };
}
test('requires OAuth configuration without making network requests', async () => {
  let calls = 0;
  const { client } = fixture(async () => {
    calls++;
    return json({});
  }, false);
  assert.equal(client.configured(), false);
  await assert.rejects(client.connect(), /Client ID/);
  assert.equal(calls, 0);
});
test('invalid token is removed and retried once with a fresh token', async () => {
  const auth = [];
  let calls = 0;
  const { client, counts } = fixture(async (_url, options) => {
    auth.push(options.headers.Authorization);
    return ++calls === 1
      ? json({ error: { message: 'Expired' } }, 401)
      : json({ calendars: { primary: { busy: [] } } });
  });
  assert.deepEqual(await client.busy('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'), []);
  assert.equal(counts().removals, 1);
  assert.notEqual(auth[0], auth[1]);
});
test('freebusy partial failures stop planning', async () => {
  const { client } = fixture(async () =>
    json({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }),
  );
  await assert.rejects(
    client.busy('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z'),
    /Could not check/,
  );
});
test('event reads follow pagination and omit declined appointments', async () => {
  const requests = [];
  const event = {
    id: 'a',
    summary: 'Class',
    start: { dateTime: '2026-10-28T10:00:00Z' },
    end: { dateTime: '2026-10-28T11:00:00Z' },
  };
  const { client } = fixture(async (url) => {
    requests.push(url);
    return requests.length === 1
      ? json({ items: [event], nextPageToken: 'page-two' })
      : json({
          items: [
            { ...event, id: 'b', attendees: [{ self: true, responseStatus: 'declined' }] },
            {
              ...event,
              id: 'c',
              summary: 'Work',
              extendedProperties: { private: { wacBlockId: 'block' } },
            },
          ],
        });
  });
  const events = await client.events('2026-10-28T00:00:00Z', '2026-10-29T00:00:00Z');
  assert.equal(events.length, 2);
  assert.equal(events[1].wac, true);
  assert.match(requests[1], /pageToken=page-two/);
});
const block = {
  id: 'block-1',
  taskId: 'task-1',
  start: '2026-10-29T10:00:00Z',
  end: '2026-10-29T11:00:00Z',
};
const task = {
  id: 'task-1',
  title: 'Report',
  course: 'CSCE 671',
  due: '2026-10-30T23:00:00Z',
  estimateMinutes: 180,
  effort: 'medium',
};
test('creates a non-inviting event with deterministic ID and requested reminders', async () => {
  const bodies = [];
  const { client } = fixture(async (url, options) => {
    assert.match(url, /primary\/events\?sendUpdates=none/);
    bodies.push(JSON.parse(options.body));
    return json(bodies.at(-1));
  });
  await client.createBlock(block, task, 'instance-1', 0);
  await client.createBlock(block, task, 'instance-1', 5);
  assert.equal(bodies[0].id, bodies[1].id);
  assert.match(bodies[0].id, /^[0-9a-v]{64}$/);
  assert.deepEqual(bodies[0].reminders, { useDefault: false, overrides: [] });
  assert.equal(bodies[1].reminders.overrides.length, 5);
  assert.equal(bodies[0].attendees, undefined);
  assert.equal(bodies[0].extendedProperties.private.wacTaskId, task.id);
});
test('duplicate insert recovers its own event and refuses a foreign collision', async () => {
  let foreign = false;
  const { client } = fixture(async (_url, options) =>
    options.method === 'POST'
      ? json({ error: { message: 'exists' } }, 409)
      : json({
          id: 'existing',
          status: 'confirmed',
          extendedProperties: {
            private: {
              wacBlockId: foreign ? 'someone-else' : block.id,
              wacInstanceId: 'instance-1',
            },
          },
        }),
  );
  assert.equal((await client.createBlock(block, task, 'instance-1', 1)).id, 'existing');
  foreign = true;
  await assert.rejects(client.createBlock(block, task, 'instance-1', 1), /identifier conflict/);
});
test('recovery distinguishes a missing event from a deleted event', async () => {
  let deleted = false;
  const { client } = fixture(async () =>
    deleted ? json({ status: 'cancelled' }) : json({ error: { message: 'Not found' } }, 404),
  );
  assert.equal(await client.recoverBlock(block, 'instance-1'), null);
  deleted = true;
  assert.deepEqual(await client.recoverBlock(block, 'instance-1'), { deleted: true });
});
