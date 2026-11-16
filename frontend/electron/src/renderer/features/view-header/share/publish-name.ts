// publish_name_generator.dart.

/**
 * generatePublishName: the backend limits publish names to 120 characters; the name is
 * truncated so `name-id` fits, and anything but [a-zA-Z0-9-] becomes '-'.
 */
export function generatePublishName(id: string, name: string): string {
  let trimmed = name;
  if (trimmed.length >= 120 - id.length) trimmed = trimmed.substring(0, 120 - id.length);
  return `${trimmed}-${id}`.replace(/[^a-zA-Z0-9-]/g, '-');
}
