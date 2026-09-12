import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/lib/engine';
import { markInterruptedResearchTasks } from '../src/lib/recovery';

test('orphaned running research tasks become retryable after the lease is gone', () => {
  const state = createState();
  state.tasks.push(
    {
      id: 'task-running',
      storyId: 'story-1',
      agentId: 2,
      round: 0,
      question: 'Check the official record',
      status: 'running',
      attempts: 1,
      createdAt: '2026-09-12T00:00:00.000Z',
    },
    {
      id: 'task-complete',
      storyId: 'story-1',
      agentId: 1,
      round: 0,
      question: 'Review the publication record',
      status: 'completed',
      attempts: 1,
      createdAt: '2026-09-12T00:00:00.000Z',
      finishedAt: '2026-09-12T00:01:00.000Z',
    },
  );

  const recovered = markInterruptedResearchTasks(state, new Date('2026-09-12T01:00:00.000Z'));

  assert.equal(recovered, 1);
  assert.equal(state.tasks[0].status, 'failed');
  assert.equal(state.tasks[0].finishedAt, '2026-09-12T01:00:00.000Z');
  assert.match(state.tasks[0].error ?? '', /later GO may retry/i);
  assert.equal(state.tasks[1].status, 'completed');
  assert.equal(state.audit.at(-1)?.action, 'research.interrupted_recovered');
});
