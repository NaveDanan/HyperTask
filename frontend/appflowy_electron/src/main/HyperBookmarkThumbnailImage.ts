import { nativeImage } from 'electron';
/** Decode once after bounded structural inspection; PNG snapshots strip source metadata and animation. */
export function hyperNormalizeBookmarkThumbnail(bytes: Buffer): Buffer {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw Error('The thumbnail image could not be decoded.');
  return image.toPNG();
}
