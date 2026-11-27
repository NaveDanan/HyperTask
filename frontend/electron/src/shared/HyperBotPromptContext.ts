export const HYPER_BOT_PROMPT_LIMIT = 20_000;

export function hyperBotSkillInvocation(asset: { id: string; name: string }): string {
  const slug = asset.name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (/[a-z]/.test(slug) ? slug.slice(0, 48) : 'skill') + '-' + asset.id.slice(0, 8);
}

/** Fenced code is message context and cannot address a bot or invoke a slash command. */
export function hyperBotPromptRoutingText(text: string): string {
  return hyperBotMapPromptProse(text, line => line, line => ' '.repeat(line.length));
}

const fencePattern = /^[ \t]{0,3}(~{3,}|`{3,})(.*)$/;

export function hyperBotMapPromptProse(text: string, prose: (line: string) => string, context = (line: string) => line): string {
  let fence: string | undefined;
  return text.split('\n').map((line, index, lines) => {
    const marker = fencePattern.exec(line);
    if (fence) {
      if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]?.trim()) {
        fence = undefined;
      }
      return context(line);
    }
    if (!marker) {
      const fileHeader = /^File: \[.*\]\([^)\s]+\)$/.test(line) && fencePattern.test(lines[index + 1] ?? '');
      return fileHeader ? context(line) : prose(line);
    }
    fence = marker[1];
    return context(line);
  }).join('\n');
}
