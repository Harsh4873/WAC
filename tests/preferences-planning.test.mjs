import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planTask,
  validateTask,
  DEFAULT_SETTINGS,
  blockDuration,
  dayKey,
  overlaps,
  initialState,
} from '../src/core.mjs';
import { createController } from '../src/controller.mjs';
const now = new Date('2026-10-28T08:00:00');
const task = () =>
  validateTask({
    title: 'Design brief',
    type: 'project',
    size: 1,
    due: '2026-10-30T23:00:00',
    estimateMinutes: 120,
  });
test('supports 25-minute focus sessions with an exact final remainder', () => {
  const result = planTask(task(), [], [], DEFAULT_SETTINGS, now, { blockMinutes: 25 });
  assert.deepEqual(result.blocks.map(blockDuration), [25, 25, 25, 25, 20]);
  assert.equal(result.unscheduledMinutes, 0);
});
test('preserves custom block lengths and their order', () => {
  const result = planTask(task(), [], [], DEFAULT_SETTINGS, now, {
    blockMinutes: 45,
    customDurations: [25, 45, 50],
  });
  assert.deepEqual(result.blocks.map(blockDuration), [25, 45, 50]);
  assert.equal(result.unscheduledMinutes, 0);
});
test('custom shorter totals are partial plans and oversized totals are rejected', () => {
  const result = planTask(task(), [], [], DEFAULT_SETTINGS, now, { customDurations: [25, 45] });
  assert.equal(result.unscheduledMinutes, 50);
  assert.throws(
    () => planTask(task(), [], [], DEFAULT_SETTINGS, now, { customDurations: [90, 90] }),
    /more than/,
  );
  assert.throws(() => planTask(task(), [], [], DEFAULT_SETTINGS, now, { customDurations: [0] }));
});
test('custom blocks still respect real availability, breaks and daily limits', () => {
  const busy = [{ start: '2026-10-28T09:00:00', end: '2026-10-28T11:00:00' }];
  const result = planTask(task(), [], busy, { ...DEFAULT_SETTINGS, dailyLimit: 60 }, now, {
    customDurations: [25, 45, 50],
  });
  assert.deepEqual(result.blocks.map(blockDuration), [25, 45, 50]);
  const onBusyDay = result.blocks.find((block) => dayKey(block.start) === '2026-10-28');
  assert.equal(new Date(onBusyDay.start).getTime(), new Date('2026-10-28T11:15:00').getTime());
  assert.ok(result.blocks.every((block) => !busy.some((event) => overlaps(block, event, 15))));
  for (const key of new Set(result.blocks.map((block) => dayKey(block.start)))) {
    const total = result.blocks
      .filter((block) => dayKey(block.start) === key)
      .reduce((sum, block) => sum + blockDuration(block), 0);
    assert.ok(total <= 60);
  }
});
test('existing data migrates without losing tasks or Google connection, and onboarding is remembered', async () => {
  let state = initialState();
  delete state.profile;
  state.google.connected = true;
  const ids = state.tasks.map((t) => t.id);
  const run = createController({
    load: async () => structuredClone(state),
    save: async (value) => {
      state = structuredClone(value);
    },
    now: () => now,
  });
  assert.equal((await run({ type: 'GET_STATE' })).state.profile, undefined);
  await run({
    type: 'SAVE_PROFILE',
    profile: { fieldOfStudy: 'Art history', preferredBlockMinutes: 25 },
  });
  assert.equal(state.profile.onboardingComplete, true);
  assert.equal(state.profile.fieldOfStudy, 'Art history');
  assert.deepEqual(
    state.tasks.map((t) => t.id),
    ids,
  );
  assert.equal(state.google.connected, true);
  assert.equal(state.settings.blockMinutes, 25);
});
test('saving a customized proposal rechecks its lengths and available time', async () => {
  let state = initialState();
  state.tasks = [task()];
  const run = createController({
    load: async () => structuredClone(state),
    save: async (value) => {
      state = structuredClone(value);
    },
    now: () => now,
  });
  const id = state.tasks[0].id;
  const options = { blockMinutes: 50, customDurations: [25, 45, 50] };
  const proposal = await run({ type: 'PLAN', id, options });
  await assert.rejects(
    run({ type: 'SAVE_PLAN', id, blocks: proposal.blocks, options: { blockMinutes: 60 } }),
    /lengths changed/,
  );
  await run({ type: 'SAVE_PLAN', id, blocks: proposal.blocks, options });
  assert.deepEqual(state.blocks.map(blockDuration), [25, 45, 50]);
});
