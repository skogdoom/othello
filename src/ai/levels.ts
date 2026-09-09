export type Level = 'easy' | 'medium' | 'hard';

export const LEVELS: readonly Level[] = ['easy', 'medium', 'hard'];

export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}
