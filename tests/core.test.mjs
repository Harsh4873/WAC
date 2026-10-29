import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTask,
  validateTask,
  validateSettings,
  DEFAULT_SETTINGS,
  planTask,
  validatePlan,
  overlaps,
  blockDuration,
  addDays,
  dayKey,
  initialState,
  tierFor,
} from '../src/core.mjs';

const settings = { ...DEFAULT_SETTINGS };
const now = new Date('2026-10-28T08:00:00');
const task = (extra = {}) =>
  validateTask({
    title: 'Read papers',
    course: 'CSCE 671',
    type: 'reading',
    size: 20,
    familiarity: 'some',
    due: '2026-10-30T23:00:00',
    estimateMinutes: 180,
    ...extra,
  });
test('estimates provide an editable range and familiarity changes time', () => {
  const familiar = estimateTask({ type: 'reading', size: 20, familiarity: 'familiar' });
  const novice = estimateTask({ type: 'reading', size: 20, familiarity: 'new' });
  assert.ok(familiar.minutes < novice.minutes);
  assert.ok(familiar.low <= familiar.minutes && familiar.high >= familiar.minutes);
  assert.match(familiar.reason, /20 pages/);
  assert.throws(() => estimateTask({ type: 'unknown' }));
  assert.throws(() => estimateTask({ type: 'reading', size: -1 }));
});
test('validates user input and keeps workload separate from urgency', () => {
  assert.throws(() => task({ title: ' ' }));
  assert.throws(() => task({ due: 'not a date' }));
  assert.throws(() => task({ estimateMinutes: NaN }));
  assert.throws(() => task({ estimateMinutes: 14 }));
  assert.equal(task({ estimateMinutes: 30, due: '2026-10-28T09:00:00' }).effort, 'low');
  assert.equal(task({ estimateMinutes: 30, effort: 'high' }).effort, 'high');
  assert.equal(tierFor(180), 'medium');
});
test('finds future work blocks, avoids appointments and respects breaks', () => {
  const busy = [{ start: '2026-10-28T09:00:00', end: '2026-10-28T11:00:00' }];
  const result = planTask(task(), [], busy, settings, now);
  assert.equal(result.unscheduledMinutes, 0);
  assert.equal(
    result.blocks.reduce((n, b) => n + blockDuration(b), 0),
    180,
  );
  for (const b of result.blocks) {
    assert.ok(new Date(b.start) > now);
    assert.ok(new Date(b.end) <= new Date(task().due));
    assert.ok(!busy.some((e) => overlaps(b, e, settings.breakMinutes)));
  }
  assert.equal(result.blocks[0].start, new Date('2026-10-28T11:15:00').toISOString());
  assert.doesNotThrow(() => validatePlan(task(), result.blocks, [], busy, settings, now));
});
test('deducts existing planned time and applies daily work cap', () => {
  const t = task({ estimateMinutes: 300 });
  const existing = [{ taskId: t.id, start: '2026-10-28T09:00:00', end: '2026-10-28T10:00:00' }];
  const result = planTask(t, existing, [], { ...settings, dailyLimit: 120 }, now);
  assert.equal(
    result.blocks.reduce((n, b) => n + blockDuration(b), 0),
    240,
  );
  for (const key of new Set(result.blocks.map((b) => dayKey(b.start)))) {
    const total = [...existing, ...result.blocks]
      .filter((b) => dayKey(b.start) === key)
      .reduce((n, b) => n + blockDuration(b), 0);
    assert.ok(total <= 120);
  }
});
test('reports partial plans and impossible deadlines instead of overbooking', () => {
  const t = task({ estimateMinutes: 180, due: '2026-10-28T10:00:00' });
  const result = planTask(t, [], [], settings, now);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.unscheduledMinutes, 120);
  assert.equal(
    planTask(task({ due: '2026-10-27T23:00:00' }), [], [], settings, now).blocks.length,
    0,
  );
});
test('excludes weekends and caps search horizon', () => {
  const friday = new Date('2026-10-30T20:00:00');
  const result = planTask(
    task({ due: '2026-11-02T23:00:00' }),
    [],
    [],
    { ...settings, weekends: false },
    friday,
  );
  assert.equal(dayKey(result.blocks[0].start), '2026-11-02');
  const far = planTask(
    task({ due: '2027-02-01T23:00:00', estimateMinutes: 2400 }),
    [],
    [],
    { ...settings, dailyLimit: 60, blockMinutes: 60 },
    now,
  );
  assert.ok(far.unscheduledMinutes > 0);
  assert.ok(far.blocks.every((b) => new Date(b.end) <= addDays(now, 30)));
});
test('rejects stale plans, over-allocation, outside-hours work and gaps', () => {
  const t = task();
  const result = planTask(t, [], [], settings, now);
  assert.throws(
    () => validatePlan(t, result.blocks, [], [result.blocks[0]], settings, now),
    /no longer free/,
  );
  assert.throws(
    () => validatePlan({ ...t, estimateMinutes: 30 }, result.blocks, [], [], settings, now),
    /estimate changed/,
  );
  assert.throws(() =>
    validatePlan(
      t,
      [{ start: '2026-10-28T07:00:00', end: '2026-10-28T08:00:00' }],
      [],
      [],
      settings,
      now,
    ),
  );
  assert.throws(
    () =>
      validatePlan(
        t,
        [
          { start: '2026-10-28T09:00:00', end: '2026-10-28T10:00:00' },
          { start: '2026-10-28T10:00:00', end: '2026-10-28T11:00:00' },
        ],
        [],
        [],
        settings,
        now,
      ),
    /no longer free/,
  );
});
test('settings reject reversed hours and invalid reminder counts', () => {
  assert.throws(() => validateSettings({ workStart: 19, workEnd: 9 }));
  assert.throws(() => validateSettings({ reminderCount: 6 }));
  assert.throws(() => validateSettings({ dailyLimit: 30, blockMinutes: 60 }));
  assert.equal(validateSettings({ reminderCount: 0 }).reminderCount, 0);
});
test('local-day arithmetic survives daylight-saving changes', () => {
  const old = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const before = new Date('2026-11-01T00:00:00');
    const after = addDays(before, 1);
    assert.equal(dayKey(after), '2026-11-02');
    assert.equal((after - before) / 3600000, 25);
    const t = task({ due: '2026-11-03T23:00:00', estimateMinutes: 300 });
    const result = planTask(
      t,
      [],
      [],
      { ...settings, dailyLimit: 120 },
      new Date('2026-10-31T20:00:00'),
    );
    assert.ok(result.blocks.every((b) => new Date(b.start).getHours() >= 9));
    assert.equal(result.unscheduledMinutes, 0);
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
test('demo assignments are future-relative and IDs are unique', () => {
  const state = initialState();
  assert.equal(new Set(state.tasks.map((t) => t.id)).size, 4);
  assert.ok(state.tasks.every((t) => new Date(t.due) > new Date()));
});
