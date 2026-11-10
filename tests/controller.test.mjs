import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/controller.mjs';
import { initialState, validateTask } from '../src/core.mjs';
const now = new Date('2026-10-28T08:00:00');
function fixture(google = null) {
  let data = initialState();
  data.tasks = [
    validateTask({
      title: 'Report',
      type: 'writing',
      size: 400,
      due: '2026-10-30T23:00:00',
      estimateMinutes: 120,
    }),
  ];
  const run = createController({
    load: async () => structuredClone(data),
    save: async (s) => {
      data = structuredClone(s);
    },
    google,
    now: () => now,
  });
  return {
    run,
    read: () => structuredClone(data),
    write: (s) => {
      data = s;
    },
  };
}
test('serializes writes so concurrent task changes are preserved', async () => {
  const { run, read } = fixture();
  await Promise.all(
    ['A', 'B', 'C'].map((title) =>
      run({
        type: 'SAVE_TASK',
        task: { title, type: 'reading', size: 10, due: '2026-10-30T23:00:00' },
      }),
    ),
  );
  assert.equal(read().tasks.length, 4);
});
test('revalidates a proposal so a duplicate submission cannot overbook', async () => {
  const { run, read } = fixture();
  const id = read().tasks[0].id;
  const p = await run({ type: 'PLAN', id });
  const results = await Promise.allSettled([
    run({ type: 'SAVE_PLAN', id, blocks: p.blocks }),
    run({ type: 'SAVE_PLAN', id, blocks: p.blocks }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(read().blocks.length, 2);
});
test('moves a local block earlier and keeps a published block where it is', async () => {
  const { run, read, write } = fixture();
  const s = read();
  s.blocks = [
    {
      id: 'move-me',
      taskId: s.tasks[0].id,
      start: '2026-10-28T13:00:00',
      end: '2026-10-28T14:00:00',
    },
  ];
  write(s);
  await run({ type: 'MOVE_EARLIER', id: 'move-me' });
  assert.equal(read().blocks[0].start, new Date('2026-10-28T12:45:00').toISOString());
  const published = read();
  published.blocks[0].googleEventId = 'event';
  write(published);
  await assert.rejects(run({ type: 'MOVE_EARLIER', id: 'move-me' }), /Google Calendar/);
});
test('publishes with an assignment reminder count when one is set', async () => {
  let seen = null;
  const google = {
    busy: async () => [],
    recoverBlock: async () => null,
    createBlock: async (_block, _task, _instanceId, reminders) => {
      seen = reminders;
      return {
        id: 'event',
        summary: 'WAC report',
        start: { dateTime: '2026-10-29T15:00:00Z' },
        end: { dateTime: '2026-10-29T16:00:00Z' },
      };
    },
  };
  const { run, read, write } = fixture(google);
  const s = read();
  s.google.connected = true;
  s.tasks[0].reminderCount = 3;
  s.settings.reminderCount = 1;
  s.blocks = [
    {
      id: 'remind',
      taskId: s.tasks[0].id,
      start: '2026-10-29T15:00:00Z',
      end: '2026-10-29T16:00:00Z',
    },
  ];
  write(s);
  await run({ type: 'PUBLISH', ids: ['remind'] });
  assert.equal(seen, 3);
});
test('demo mode cannot publish or fake a successful Google connection', async () => {
  const { run } = fixture();
  await assert.rejects(run({ type: 'CONNECT' }), /Chrome extension/);
  await assert.rejects(run({ type: 'PUBLISH', ids: [] }), /Connect/);
});
test('protects published blocks from local deletion, and reconciles remote moves', async () => {
  const google = {
    getBlock: async () => ({
      start: { dateTime: '2026-10-29T11:00:00Z' },
      end: { dateTime: '2026-10-29T12:00:00Z' },
      summary: 'Moved work',
    }),
    events: async () => [],
  };
  const { run, read, write } = fixture(google);
  const s = read();
  s.google.connected = true;
  s.blocks = [
    {
      id: 'b1',
      taskId: s.tasks[0].id,
      start: '2026-10-29T09:00:00Z',
      end: '2026-10-29T10:00:00Z',
      googleEventId: 'event1',
    },
  ];
  write(s);
  await assert.rejects(run({ type: 'DELETE_TASK', id: s.tasks[0].id }), /published/);
  await run({ type: 'CLEAR_PLAN', id: s.tasks[0].id });
  assert.equal(read().blocks.length, 1);
  await run({ type: 'REFRESH_CALENDAR' });
  assert.equal(read().blocks[0].start, '2026-10-29T11:00:00Z');
  google.getBlock = async () => null;
  await run({ type: 'REFRESH_CALENDAR' });
  assert.equal(read().blocks.length, 0);
});
test('publishing preserves partial success and retries only remaining blocks', async () => {
  let count = 0,
    fail = true;
  const remote = new Map();
  const google = {
    configured: () => true,
    busy: async () => [],
    recoverBlock: async (b) => remote.get(b.id) || null,
    createBlock: async (b) => {
      count++;
      if (count === 2 && fail) throw new Error('Temporary network error');
      const e = {
        id: `google-${b.id}`,
        summary: 'WAC report',
        start: { dateTime: b.start },
        end: { dateTime: b.end },
      };
      remote.set(b.id, e);
      return e;
    },
  };
  const { run, read, write } = fixture(google);
  const s = read();
  s.google.connected = true;
  write(s);
  const id = s.tasks[0].id;
  const p = await run({ type: 'PLAN', id });
  await run({ type: 'SAVE_PLAN', id, blocks: p.blocks });
  const ids = read().blocks.map((b) => b.id);
  await assert.rejects(run({ type: 'PUBLISH', ids }), /Temporary/);
  assert.equal(read().blocks.filter((b) => b.googleEventId).length, 1);
  fail = false;
  await run({ type: 'PUBLISH', ids });
  assert.equal(remote.size, 2);
  assert.equal(count, 3);
});
test('recovers a remote success with a lost response before conflict checks', async () => {
  let creates = 0;
  const google = {
    busy: async () => {
      throw new Error('Should not query busy for recovered events');
    },
    recoverBlock: async (b) => ({
      id: 'recovered',
      summary: 'WAC report',
      start: { dateTime: b.start },
      end: { dateTime: b.end },
    }),
    createBlock: async () => {
      creates++;
    },
  };
  const { run, read, write } = fixture(google);
  const s = read();
  s.google.connected = true;
  s.blocks = [
    {
      id: 'lost',
      taskId: s.tasks[0].id,
      start: '2026-10-29T10:00:00Z',
      end: '2026-10-29T11:00:00Z',
    },
  ];
  write(s);
  await run({ type: 'PUBLISH', ids: ['lost'] });
  assert.equal(creates, 0);
  assert.equal(read().blocks[0].googleEventId, 'recovered');
});
test('a changed Google calendar prevents writes rather than falling back to demo', async () => {
  let creates = 0;
  const google = {
    busy: async () => [{ start: '2026-10-29T09:00:00Z', end: '2026-10-29T12:00:00Z' }],
    recoverBlock: async () => null,
    createBlock: async () => {
      creates++;
    },
  };
  const { run, read, write } = fixture(google);
  const s = read();
  s.google.connected = true;
  s.blocks = [
    {
      id: 'conflict',
      taskId: s.tasks[0].id,
      start: '2026-10-29T10:00:00Z',
      end: '2026-10-29T11:00:00Z',
    },
  ];
  write(s);
  await assert.rejects(run({ type: 'PUBLISH', ids: ['conflict'] }), /conflicts/);
  assert.equal(creates, 0);
  google.busy = async () => {
    throw new Error('Access revoked');
  };
  await assert.rejects(run({ type: 'PLAN', id: s.tasks[0].id }), /Access revoked/);
});
