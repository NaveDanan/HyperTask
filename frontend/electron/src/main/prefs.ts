import fs from 'node:fs/promises';
import path from 'node:path';

/** A double that must be written as `1920.0`, the way Dart encodes doubles. */
class DoubleValue {
  constructor(readonly value: number) {}
}

const DOUBLE_MARK = '\u0000double\u0000';

/** Dart's jsonEncode of a double: integral values keep a `.0`. */
function formatDouble(value: number): string {
  if (!Number.isFinite(value)) return 'null';
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/**
 * Parses the file keeping which numbers were written as doubles (`1.0`, `1e3`), so that
 * rewriting the file does not turn Flutter's doubles into ints, which Dart's getDouble
 * would then reject.
 */
function parsePreservingDoubles(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text, (_key, value, context?: { source?: string }) =>
    typeof value === 'number' && context?.source && /[.eE]/.test(context.source) ? new DoubleValue(value) : value,
  );
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function serialize(data: Record<string, unknown>): string {
  const json = JSON.stringify(data, (_key, value) =>
    value instanceof DoubleValue ? `${DOUBLE_MARK}${formatDouble(value.value)}` : value,
  );
  // JSON.stringify escapes the NUL marker as \u0000.
  return json.replace(/"\\u0000double\\u0000([^"]*)"/g, '$1');
}

const plain = (value: unknown) => (value instanceof DoubleValue ? value.value : value);

/**
 * Reads and writes the same shared_preferences.json the Flutter app uses
 * (shared_preferences_windows: `<support dir>/shared_preferences.json`, keys prefixed
 * with `flutter.`), so settings carry over between the two shells.
 */
export class SharedPreferences {
  private data: Record<string, unknown> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly prefix = 'flutter.',
  ) {}

  async getAll(): Promise<Record<string, unknown>> {
    const data = await this.load();
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(this.prefix)) result[key.slice(this.prefix.length)] = plain(value);
    }
    return result;
  }

  async get(key: string): Promise<unknown> {
    return plain((await this.load())[this.prefix + key]);
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = await this.load();
    data[this.prefix + key] = value;
    return this.persist();
  }

  /** SharedPreferences.setDouble: stored with a decimal point even when integral. */
  async setDouble(key: string, value: number): Promise<void> {
    const data = await this.load();
    data[this.prefix + key] = new DoubleValue(value);
    return this.persist();
  }

  async remove(key: string): Promise<void> {
    const data = await this.load();
    delete data[this.prefix + key];
    return this.persist();
  }

  private async load(): Promise<Record<string, unknown>> {
    if (this.data) return this.data;
    try {
      this.data = parsePreservingDoubles(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
    return this.data;
  }

  private persist(): Promise<void> {
    const snapshot = serialize(this.data ?? {});
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temp, snapshot, 'utf8');
      await fs.rename(temp, this.file);
    });
    return this.writing;
  }
}
