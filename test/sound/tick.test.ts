import { test } from "node:test";
import assert from "node:assert/strict";
import { tickWav } from "../../src/sound/tick.ts";

const peak = (wav: Buffer, fromSample: number, toSample: number): number => {
  let max = 0;
  for (let i = fromSample; i < toSample; i++)
    max = Math.max(max, Math.abs(wav.readInt16LE(44 + i * 2)));
  return max;
};

test("tickWav: 16-bit mono PCM of whole ticks", () => {
  const sr = 8000;
  const wav = tickWav({ sampleRate: sr, seconds: 2, ticksPerSecond: 2 });
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), sr);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 44 + sr * 2 * 2);
  assert.equal(wav.readInt16LE(44 + 2000 * 2), 0); // 0.25 s: between two ticks
  assert.ok(peak(wav, 0, 160) > 1000); // first 20 ms
  assert.ok(peak(wav, 4000, 4160) > 1000); // 20 ms after 0.5 s
  assert.ok(peak(wav, 0, sr * 2) <= 16384);
});
