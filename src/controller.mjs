import {
  initialState,
  validateTask,
  validateSettings,
  planTask,
  validatePlan,
  normalizePlanOptions,
  requestedDurations,
  blockDuration,
  demoTasks,
  DEMO_REVISION,
  refreshDemoExamples,
  demoBusy,
  addDays,
  startOfWeek,
  overlaps,
  plannedMinutes,
  uid,
  collisionDays,
  relocateBlock,
  earlierSlot,
  taskReminderCount,
} from './core.mjs';
import { validateProfile } from './profile.mjs';

export function createController({ load, save, google = null, now = () => new Date() }) {
  let queue = Promise.resolve();
  const run = async (message) => {
    const loaded = await load();
    const state = loaded || initialState(now());
    if (state.version !== 1)
      throw new Error('This data version is not supported. Export your data before upgrading.');
    const find = (id) => {
      const t = state.tasks.find((t) => t.id === id);
      if (!t) throw new Error('Assignment no longer exists.');
      return t;
    };
    const fetchBusy = async () =>
      state.google.connected
        ? google.busy(now().toISOString(), addDays(now(), 31).toISOString())
        : demoBusy(now());
    const commit = async () => {
      await save(state);
      return state;
    };
    switch (message.type) {
      case 'GET_STATE': {
        const refreshed = refreshDemoExamples(state);
        if (!loaded || refreshed) await save(state);
        return {
          state,
          configured: Boolean(google?.configured()),
          extensionId: globalThis.chrome?.runtime?.id || null,
        };
      }
      case 'GET_CONTENT_STATE':
        return {
          tasks: state.tasks.map(({ id, title, course, effort, estimateMinutes }) => ({
            id,
            title,
            course,
            effort,
            estimateMinutes,
          })),
          blocks: state.blocks
            .filter((b) => b.googleEventId)
            .map(({ taskId, googleEventId, googleSummary }) => ({
              taskId,
              googleEventId,
              googleSummary,
            })),
          visualMode: state.settings.visualMode,
          collisions: collisionDays(state.tasks, state.settings.dailyLimit).map((group) => ({
            day: group.day,
            count: group.tasks.length,
            minutes: group.minutes,
          })),
        };
      case 'SAVE_TASK': {
        const previous = message.id ? find(message.id) : null;
        const task = validateTask(message.task, previous, state.profile);
        if (task.estimateMinutes < plannedMinutes(task.id, state.blocks))
          throw new Error(
            'Your estimate is shorter than the existing plan. Clear unpublished blocks first.',
          );
        if (previous) state.tasks[state.tasks.findIndex((t) => t.id === task.id)] = task;
        else state.tasks.push(task);
        return commit();
      }
      case 'SAVE_PROFILE': {
        state.profile = {
          ...validateProfile(message.profile),
          onboardingComplete: true,
          skipped: Boolean(message.skipped),
          updatedAt: now().toISOString(),
        };
        state.settings.blockMinutes = state.profile.preferredBlockMinutes;
        state.settings.dailyLimit = Math.max(
          state.settings.dailyLimit,
          state.profile.preferredBlockMinutes,
        );
        return commit();
      }
      case 'SET_EFFORT': {
        const task = find(message.id);
        if (!['low', 'medium', 'high'].includes(message.effort))
          throw new Error('Invalid effort level.');
        task.effort = message.effort;
        return commit();
      }
      case 'COMPLETE_TASK': {
        const task = find(message.id);
        task.completed = !task.completed;
        return commit();
      }
      case 'DELETE_TASK': {
        find(message.id);
        if (state.blocks.some((b) => b.taskId === message.id && b.googleEventId))
          throw new Error(
            'This task has published blocks. Delete those in Google Calendar and refresh here before removing the task.',
          );
        state.tasks = state.tasks.filter((t) => t.id !== message.id);
        state.blocks = state.blocks.filter((b) => b.taskId !== message.id);
        return commit();
      }
      case 'SET_SETTINGS':
        state.settings = validateSettings(message.settings, state.settings);
        return commit();
      case 'RESET_DEMO': {
        const keep = new Set(state.blocks.filter((b) => b.googleEventId).map((b) => b.taskId));
        const remove = new Set(
          state.tasks.filter((t) => t.source === 'demo' && !keep.has(t.id)).map((t) => t.id),
        );
        state.tasks = [...state.tasks.filter((t) => !remove.has(t.id)), ...demoTasks()];
        state.blocks = state.blocks.filter((b) => !remove.has(b.taskId));
        state.demoAnchor = now().toISOString();
        state.demoRevision = DEMO_REVISION;
        return commit();
      }
      case 'PLAN': {
        const task = find(message.id);
        if (task.completed) throw new Error('This task is already complete.');
        return {
          ...planTask(
            task,
            state.blocks,
            await fetchBusy(),
            state.settings,
            now(),
            message.options || {},
          ),
          taskId: task.id,
          realCalendar: state.google.connected,
        };
      }
      case 'SAVE_PLAN': {
        const task = find(message.id);
        if (task.completed) throw new Error('This task is already complete.');
        const remaining = Math.max(0, task.estimateMinutes - plannedMinutes(task.id, state.blocks));
        const options = normalizePlanOptions(message.options || {}, state.settings, remaining);
        const lengths = requestedDurations(remaining, options);
        const maxBlock = Math.max(options.blockMinutes, ...options.customDurations);
        const accepted = validatePlan(
          task,
          message.blocks,
          state.blocks,
          await fetchBusy(),
          { ...state.settings, blockMinutes: maxBlock },
          now(),
        );
        if (accepted.some((b, i) => blockDuration(b) !== lengths[i]))
          throw new Error('Block lengths changed. Update the plan before saving.');
        state.blocks.push(
          ...accepted.map((b) => ({ ...b, id: uid(), createdAt: now().toISOString() })),
        );
        task.blockMinutes = options.blockMinutes;
        return commit();
      }
      case 'CLEAR_PLAN':
        find(message.id);
        state.blocks = state.blocks.filter((b) => b.taskId !== message.id || b.googleEventId);
        return commit();
      case 'MOVE_BLOCK':
      case 'MOVE_EARLIER': {
        const block = state.blocks.find((item) => item.id === message.id);
        if (!block) throw new Error('That work block is no longer here.');
        const task = find(block.taskId);
        if (task.completed)
          throw new Error('This assignment is complete. Clear its work blocks first.');
        const busy = await fetchBusy();
        const moved =
          message.type === 'MOVE_EARLIER'
            ? earlierSlot(block, task, state.blocks, busy, state.settings, now())
            : relocateBlock(block, message.start, task, state.blocks, busy, state.settings, now());
        block.start = moved.start;
        block.end = moved.end;
        return commit();
      }
      case 'CONNECT': {
        if (!google)
          throw new Error('Load this folder as a Chrome extension to connect Google Calendar.');
        await google.connect();
        await google.busy(now().toISOString(), addDays(now(), 1).toISOString());
        state.calendarEvents = await google.events(
          startOfWeek(now()).toISOString(),
          addDays(now(), 31).toISOString(),
        );
        state.google = { connected: true, lastSynced: now().toISOString() };
        return commit();
      }
      case 'DISCONNECT':
        if (google) await google.disconnect();
        state.google = { connected: false };
        state.calendarEvents = [];
        return commit();
      case 'REFRESH_CALENDAR': {
        if (!state.google.connected || !google) throw new Error('Connect Google Calendar first.');
        // Read published events individually so moves outside the visible month and deletions are reconciled too.
        for (const block of [...state.blocks].filter((b) => b.googleEventId)) {
          const event = await google.getBlock(block.googleEventId);
          if (!event || event.status === 'cancelled')
            state.blocks = state.blocks.filter((b) => b.id !== block.id);
          else {
            block.start = event.start.dateTime || `${event.start.date}T00:00:00`;
            block.end = event.end.dateTime || `${event.end.date}T00:00:00`;
            block.googleSummary = event.summary || '';
            block.htmlLink = event.htmlLink;
          }
        }
        state.calendarEvents = await google.events(
          startOfWeek(now()).toISOString(),
          addDays(now(), 31).toISOString(),
        );
        state.google.lastSynced = now().toISOString();
        return commit();
      }
      case 'PUBLISH': {
        if (!state.google.connected || !google) throw new Error('Connect Google Calendar first.');
        if (!Array.isArray(message.ids)) throw new Error('Choose the blocks to publish.');
        const selected = state.blocks.filter((b) => message.ids.includes(b.id) && !b.googleEventId);
        if (!selected.length) throw new Error('There are no unpublished blocks in this selection.');
        // Recover a prior successful write whose response was lost before checking conflicts.
        // Otherwise our own newly created event would look like a conflicting appointment on retry.
        for (const block of selected) {
          const event = await google.recoverBlock(block, state.instanceId);
          if (event?.deleted)
            throw new Error(
              'A previously published block was deleted in Google Calendar. Clear that local block and plan again.',
            );
          if (event) {
            block.googleEventId = event.id;
            block.googleSummary = event.summary;
            block.htmlLink = event.htmlLink;
            block.start = event.start.dateTime;
            block.end = event.end.dateTime;
            await save(state);
          }
        }
        const pending = selected.filter((b) => !b.googleEventId);
        const busy = pending.length ? await fetchBusy() : [];
        for (const block of pending) {
          const task = find(block.taskId);
          if (task.completed)
            throw new Error(
              `“${task.title}” is complete. Clear its unpublished blocks before publishing.`,
            );
          if (new Date(block.start) <= now() || new Date(block.end) > new Date(task.due))
            throw new Error(
              'Some blocks are in the past or after their deadline. Clear them and find a new time.',
            );
          if (busy.some((b) => overlaps(block, b)))
            throw new Error(
              'Your calendar has changed and a work block now conflicts. Clear the affected plan and find a new time.',
            );
        }
        for (const block of pending) {
          const task = find(block.taskId);
          const event = await google.createBlock(
            block,
            task,
            state.instanceId,
            taskReminderCount(task, state.settings),
          );
          block.googleEventId = event.id;
          block.googleSummary = event.summary;
          block.htmlLink = event.htmlLink;
          block.start = event.start.dateTime;
          block.end = event.end.dateTime;
          await save(state); // Record each success; a failed request can be retried without duplicating events.
        }
        state.google.lastSynced = now().toISOString();
        return commit();
      }
      default:
        throw new Error('Unknown WAC action.');
    }
  };
  return (message) => {
    const result = queue.then(() => run(message));
    queue = result.catch(() => {});
    return result;
  };
}
