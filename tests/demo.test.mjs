import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/controller.mjs';
import {
  addDays,
  atHour,
  dayKey,
  demoBusy,
  DEMO_REVISION,
  initialState,
  overlaps,
  validateTask,
} from '../src/core.mjs';

const anchor = new Date('2026-10-28T08:00:00');
function legacyState() {
  const state = initialState(anchor);
  delete state.demoRevision;
  state.tasks.forEach((task, index) => {
    task.due = atHour(addDays(anchor, [2, 3, 3, 5][index]), 23).toISOString();
    delete task.demoKey;
    delete task.demoOriginalDue;
  });
  return state;
}
function fixture(state, now = new Date('2026-11-30T08:00:00')) {
  let data = structuredClone(state);
  let saves = 0;
  const run = createController({
    load: async () => structuredClone(data),
    save: async (value) => {
      data = structuredClone(value);
      saves++;
    },
    now: () => now,
  });
  return { run, read: () => structuredClone(data), saves: () => saves };
}
function block(taskId, id, extra = {}) {
  return {
    id,
    taskId,
    start: '2026-10-29T12:00:00',
    end: '2026-10-29T13:00:00',
    ...extra,
  };
}

test('opening an older demo refreshes deadlines once without changing task IDs', async () => {
  const state = legacyState();
  const ids = state.tasks.map((t) => t.id);
  state.blocks = [block(ids[0], 'stale-local')];
  const { run, read, saves } = fixture(state);
  const { state: refreshed } = await run({ type: 'GET_STATE' });
  assert.deepEqual(
    refreshed.tasks.map((t) => dayKey(t.due)),
    ['2026-12-07', '2026-12-10', '2026-12-10', '2026-12-14'],
  );
  assert.deepEqual(
    refreshed.tasks.map((t) => t.id),
    ids,
  );
  assert.equal(refreshed.blocks.length, 0);
  assert.equal(refreshed.demoRevision, DEMO_REVISION);
  await run({ type: 'GET_STATE' });
  assert.deepEqual(read(), refreshed);
  assert.equal(saves(), 1);
});

test('refreshing examples preserves personal tasks, published events, and connection settings', async () => {
  const state = legacyState();
  state.tasks[1].due = new Date('2026-11-25T23:00:00').toISOString();
  state.tasks[2].completed = true;
  const manual = validateTask({ ...state.tasks[0] });
  state.tasks.push(manual);
  state.google = { connected: true, lastSynced: '2026-10-28T12:00:00Z' };
  state.profile = { onboardingComplete: true, preferredBlockMinutes: 45 };
  state.blocks = [
    block(state.tasks[0].id, 'stale-local'),
    block(state.tasks[1].id, 'edited-local'),
    block(state.tasks[3].id, 'published', { googleEventId: 'keep-google-event' }),
    block(manual.id, 'manual-local'),
  ];
  const { run, read } = fixture(state);
  await run({ type: 'GET_STATE' });
  const refreshed = read();
  assert.deepEqual(refreshed.tasks.slice(1), state.tasks.slice(1));
  assert.deepEqual(refreshed.blocks, state.blocks.slice(1));
  assert.deepEqual(refreshed.google, state.google);
  assert.deepEqual(refreshed.profile, state.profile);
  assert.deepEqual(refreshed.settings, state.settings);
});

test('edited or analyzed examples are excluded from the automatic refresh', async () => {
  for (const changes of [
    { title: 'My literature review' },
    { description: 'My revised instructions' },
    { estimateMinutes: 210 },
    { effort: 'high' },
    { analysis: { provider: 'demo' } },
    { attachment: { name: 'assignment.pdf' } },
  ]) {
    const state = legacyState();
    Object.assign(state.tasks[0], changes);
    state.blocks = [block(state.tasks[0].id, 'keep-local')];
    const { run, read } = fixture(state);
    await run({ type: 'GET_STATE' });
    assert.deepEqual(read().tasks[0], state.tasks[0]);
    assert.deepEqual(read().blocks, state.blocks);
  }
});

test('opening an older empty demo does not restore deleted examples', async () => {
  const state = legacyState();
  state.tasks = [];
  const { run, read } = fixture(state);
  await run({ type: 'GET_STATE' });
  assert.deepEqual(read().tasks, []);
});

test('Load examples creates December fixtures and preserves manual and published work', async () => {
  const state = legacyState();
  const published = state.tasks[3];
  const manual = validateTask({ ...state.tasks[0], title: 'Personal report' });
  state.tasks.push(manual);
  state.blocks = [
    block(state.tasks[0].id, 'remove-local'),
    block(published.id, 'published', { googleEventId: 'keep-google-event' }),
    block(manual.id, 'manual-local'),
  ];
  const { run, read } = fixture(state);
  await run({ type: 'RESET_DEMO' });
  const refreshed = read();
  assert.deepEqual(refreshed.tasks.slice(0, 2), [published, manual]);
  assert.deepEqual(
    refreshed.tasks.slice(2).map((t) => dayKey(t.due)),
    ['2026-12-07', '2026-12-10', '2026-12-10', '2026-12-14'],
  );
  assert.deepEqual(refreshed.blocks, state.blocks.slice(1));
  assert.equal(refreshed.demoRevision, DEMO_REVISION);
});

test('planning a December example avoids current sample classes even with an old demo anchor', async () => {
  const state = initialState(anchor);
  const { run } = fixture(state);
  const proposal = await run({ type: 'PLAN', id: state.tasks[0].id });
  assert.equal(proposal.unscheduledMinutes, 0);
  assert.equal(proposal.realCalendar, false);
  assert.equal(proposal.blocks[0].start, new Date('2026-12-06T09:00:00').toISOString());
  const classes = demoBusy(new Date('2026-11-30T08:00:00'));
  assert.ok(proposal.blocks.every((block) => !classes.some((event) => overlaps(block, event, 15))));
  assert.ok(proposal.blocks.every((b) => new Date(b.end) < new Date(state.tasks[0].due)));
});
