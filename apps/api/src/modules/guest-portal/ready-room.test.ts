import { describe, expect, it } from 'vitest';
import { assignFirstFree } from './ready-room.js';

const taken = () =>
  new Error('conflicting key value violates exclusion constraint "room_assignments_no_overlap"');

describe('assignFirstFree', () => {
  it('moves on to the next room when one was taken meanwhile', async () => {
    const tried: string[] = [];
    const assigned = await assignFirstFree(['101', '102', '103'], async (room) => {
      tried.push(room);
      if (room === '101') throw taken();
    });
    expect(assigned).toBe('102');
    expect(tried).toEqual(['101', '102']);
  });

  it('returns null when every room was taken', async () => {
    const assigned = await assignFirstFree(['101', '102'], async () => {
      throw taken();
    });
    expect(assigned).toBeNull();
  });

  it('rethrows any other error instead of treating it as a taken room', async () => {
    const tried: string[] = [];
    const failure = new Error('connection reset');
    await expect(
      assignFirstFree(['101', '102'], async (room) => {
        tried.push(room);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(tried).toEqual(['101']);
  });
});
