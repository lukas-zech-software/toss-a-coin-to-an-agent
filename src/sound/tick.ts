/**
 * Quiet clockwork tick for the "working" sound (audio spec §4): 16-bit mono PCM WAV, alternating tick/tack, each a short
 * decaying sine with silence in between. The length is a whole number of ticks, so a looped file keeps its beat.
 * Loudness is set at playback (afplay -v).
 */
export function tickWav(
  o: { sampleRate?: number; seconds?: number; ticksPerSecond?: number } = {},
): Buffer {
  const sr = o.sampleRate ?? 22050;
  const seconds = o.seconds ?? 30;
  const perSecond = o.ticksPerSecond ?? 2;
  const samples = Math.round(sr * seconds);
  const period = Math.round(sr / perSecond);
  const tickLen = Math.round(sr * 0.012);
  const amplitude = 0.5 * 32767;

  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16); // fmt chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);

  for (let start = 0, n = 0; start < samples; start += period, n++) {
    const freq = n % 2 === 0 ? 2000 : 1500;
    for (let i = 0; i < tickLen && start + i < samples; i++) {
      const t = i / sr;
      // phase offset of a quarter period: the first sample is at full swing, not zero
      const v =
        amplitude * Math.exp(-t / 0.003) * Math.cos(2 * Math.PI * freq * t);
      wav.writeInt16LE(Math.round(v), 44 + (start + i) * 2);
    }
  }
  return wav;
}
