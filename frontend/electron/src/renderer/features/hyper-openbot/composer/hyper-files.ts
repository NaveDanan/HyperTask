// Copyright (c) 2026 CopilotKit. SPDX-License-Identifier: MIT
// Adapted for HyperTask, developed by NaveDanan. See REUSE.md.
let rejectionSequence = 0;
export type HyperRejectedFile = { id: string; name: string; reason: string };

export const HyperMAX_ATTACHMENTS_PER_MESSAGE = 8;

export const HyperMAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const HyperMAX_FILE_BYTES = 1024 * 1024;

export const HyperMAX_EXTRACTED_CHARACTERS = 120_000;

export function HyperMayBeTruncatedForModel(sizeBytes: number): boolean {
  return sizeBytes > HyperMAX_EXTRACTED_CHARACTERS;
}

export const HyperACCEPTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const HyperACCEPTED_TEXT_MIME = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

export function HyperMediaTypeOf(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0].trim();
}

const MIME_NAMES_NOTHING: ReadonlySet<string> = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/unknown",
  "application/force-download",
]);

export function HyperNamesNoFormat(mimeType: string): boolean {
  const mediaType = HyperMediaTypeOf(mimeType);
  return !mediaType.includes("/") || MIME_NAMES_NOTHING.has(mediaType);
}

export type HyperAttachmentKind =
  | "image"
  | "text"
  | "unsupported-image"
  | "unsupported";

export function HyperClassifyAttachment(mimeType: string): HyperAttachmentKind {
  // The media type is what decides here — see `HyperMediaTypeOf`. Without this the composer refused a
  // file the server then accepted, which is the drift the note at the top of this file exists to
  // prevent.
  const mediaType = HyperMediaTypeOf(mimeType);
  if ((HyperACCEPTED_IMAGE_MIME as readonly string[]).includes(mediaType)) {
    return "image";
  }
  if (mediaType.startsWith("image/")) return "unsupported-image";
  if ((HyperACCEPTED_TEXT_MIME as readonly string[]).includes(mediaType)) {
    return "text";
  }
  return "unsupported";
}

export function HyperShouldClaimPaste(input: {
  kinds: readonly HyperAttachmentKind[];
  plainText: string;
}): boolean {
  if (input.plainText.length > 0) return false;
  return input.kinds.length > 0;
}

export type HyperScreenedFiles = {
  accepted: File[];
  rejected: HyperRejectedFile[];
};

export function HyperScreenPickedFiles(
  files: readonly File[],
  options: { alreadyStaged: number },
): HyperScreenedFiles {
  const accepted: File[] = [];
  const rejected: HyperRejectedFile[] = [];

  for (const file of files) {

    const mediaType = HyperMediaTypeOf(file.type);
    const kind = HyperClassifyAttachment(file.type);

    if (kind === "unsupported-image") {
      rejected.push(
        reject(
          file,
          mediaType === "image/svg+xml"
            ? `'${file.name}' can't be attached. SVG files aren't accepted.`
            : `'${file.name}' isn't a supported image format.`,
        ),
      );
      continue;
    }

    const unnamed = kind === "unsupported" && HyperNamesNoFormat(mediaType);

    if (kind === "unsupported" && !unnamed) {
      rejected.push(
        reject(file, `'${file.name}' isn't a file type you can attach.`),
      );
      continue;
    }

    if (kind === "image" && file.size > HyperMAX_IMAGE_BYTES) {
      rejected.push(
        reject(
          file,
          `'${file.name}' is too large for an image. The limit is ${formatBytes(HyperMAX_IMAGE_BYTES)}.`,
        ),
      );
      continue;
    }

    if (kind === "text" && file.size > HyperMAX_FILE_BYTES) {
      rejected.push(
        reject(
          file,
          `'${file.name}' is too large for a text file. The limit is ${formatBytes(HyperMAX_FILE_BYTES)}.`,
        ),
      );
      continue;
    }

    // The LOOSE ceiling for a file nobody has named yet, because this screen does not know which
    // of the two limits applies to it. Guessing the tight one would put back exactly the refusal
    // this branch exists to remove; the server applies the right limit once it has the bytes.
    if (unnamed && file.size > HyperMAX_IMAGE_BYTES) {
      rejected.push(
        reject(
          file,
          `'${file.name}' is too large. The limit is ${formatBytes(HyperMAX_IMAGE_BYTES)}.`,
        ),
      );
      continue;
    }

    if (
      options.alreadyStaged + accepted.length >=
      HyperMAX_ATTACHMENTS_PER_MESSAGE
    ) {
      rejected.push(
        reject(
          file,
          `'${file.name}' wasn't added. A message can take at most ${HyperMAX_ATTACHMENTS_PER_MESSAGE} attachments.`,
        ),
      );
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}

function reject(file: File, reason: string): HyperRejectedFile {
  return { id: String(++rejectionSequence), name: file.name, reason };
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
