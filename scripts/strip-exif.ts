import { run } from "../src/proc.ts";

/** The only tags committed fixtures keep: what the tests read, nothing that identifies a person or a device. */
export const KEEP_TAGS = ["Orientation", "FocalLength", "ExposureTime", "ISO", "FNumber", "ExposureCompensation", "Model"] as const;

/**
 * Whitelist strip (privacy): removes ALL metadata, including MakerNotes with the body/lens/internal serial numbers
 * and the owner name, then copies back only KEEP_TAGS from the original.
 */
export async function stripIdentifyingExif(file: string): Promise<void> {
  await run("exiftool", ["-overwrite_original", "-all=", "-tagsfromfile", "@", ...KEEP_TAGS.map((t) => `-${t}`), file]);
}
