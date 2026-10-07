import { createHash } from 'node:crypto';
import type { GameState } from '../shared/types.js';

type RandomState = GameState['rng'];
const rotl = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

/** Explicit, portable PRNG state: every random decision is reproduced by a checkpoint. */
export function seedRandom(seed: number): RandomState {
  const bytes = createHash('sha256').update(`arkham:xoshiro128ss-v1:${seed >>> 0}`).digest();
  const state: RandomState['state'] = [0, 4, 8, 12].map(offset => bytes.readUInt32LE(offset)) as RandomState['state'];
  if (state.every(value => value === 0)) state[0] = 1;
  return { algorithm: 'xoshiro128ss-v1', state };
}

export function nextUint32(random: RandomState): number {
  const s = random.state;
  const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
  const t = s[1] << 9;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

export function randomIndex(random: RandomState, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || count > 0xffffffff) throw new Error('Invalid random selection size.');
  // Rejection sampling avoids modulo bias, including during deck shuffles.
  const limit = 0x100000000 - (0x100000000 % count);
  let value: number;
  do { value = nextUint32(random); } while (value >= limit);
  return value % count;
}

export function shuffle<T>(items: readonly T[], random: RandomState): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(random, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
