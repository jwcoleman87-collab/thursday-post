/**
 * How long the editor's desk waits before quietly refreshing, or null for no refresh at all.
 * A hidden tab never polls: each refresh reads the whole newsroom from the database, and a
 * forgotten background tab kept the database awake around the clock.
 */
export function deskRefreshDelay({ visible, running }: { visible: boolean; running: boolean }): number | null {
  if (!visible) return null;
  return running ? 15_000 : 60_000;
}
