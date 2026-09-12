import { randomUUID } from 'node:crypto';
import type { NewsroomState } from './domain';
import { transact } from './store';

/**
 * A serverless invocation can disappear after a research task is checkpointed as
 * `running` but before the task records its terminal state. Once the owning lease
 * has expired there is no worker left that can finish that task. Marking it failed
 * preserves the interrupted attempt and lets engine.ts allocate a fresh bounded
 * later-run retry instead of leaving the story permanently stuck.
 */
export function markInterruptedResearchTasks(state: NewsroomState, at = new Date()): number {
  const interrupted = state.tasks.filter(task => task.status === 'running');
  if (!interrupted.length) return 0;

  const finishedAt = at.toISOString();
  for (const task of interrupted) {
    task.status = 'failed';
    task.finishedAt = finishedAt;
    task.error = 'The previous newsroom invocation ended before this research task recorded a terminal result. The checkpoint is preserved and a later GO may retry it with a fresh bounded attempt budget.';
  }

  state.audit.push({
    id: randomUUID(),
    action: 'research.interrupted_recovered',
    detail: `${interrupted.length} orphaned running research task(s) were closed as interrupted so the next bounded run can resume them. Completed evidence and prior attempts remain preserved.`,
    createdAt: finishedAt,
  });
  return interrupted.length;
}

export async function recoverInterruptedResearchTasks(): Promise<number> {
  return transact(data => {
    const leaseActive = Boolean(data.lease && Date.parse(data.lease.expiresAt) > Date.now());
    if (leaseActive) return 0;
    return markInterruptedResearchTasks(data.state);
  });
}
