// Which of ANSWERS_SHA256 (fs.ts) this browser has solved, numbered from 1 in that order, kept in localStorage.
// The homepage terminal and /ctf both go through here, so a solve in either place counts in both.
// A plain '1' (the format from before there was a second answer) still means the first.
const KEY = 'term-s';

export function solvedAnswers(): string[] {
  try { return (localStorage.getItem(KEY) ?? '').split(',').filter(Boolean); } catch { return []; }
}

export function markSolved(n: number) {
  const s = new Set(solvedAnswers()).add(String(n));
  try { localStorage.setItem(KEY, [...s].sort().join(',')); } catch {}
}
