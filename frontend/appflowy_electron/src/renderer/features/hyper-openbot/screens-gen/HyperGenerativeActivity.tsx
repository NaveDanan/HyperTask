// Adapted from OpenBot components/channels/chat-transcript.tsx and SDK activity rendering.
// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { OpenGenerativeUIActivityRenderer } from '@copilotkit/react-core/v2';
import { z } from 'zod';
const HyperActivityContent = z.object({
  html: z.array(z.string()).optional(), htmlComplete: z.boolean().optional(),
  css: z.string().optional(), cssComplete: z.boolean().optional(),
  jsFunctions: z.string().optional(), jsFunctionsComplete: z.boolean().optional(),
  generating: z.boolean().optional(),
});
/** Only the SDK sandbox receives remote markup and code, including streamed activity patches. */
export function HyperGenerativeActivity({content}: {content: unknown}) {
  const parsed = HyperActivityContent.safeParse(content);
  if (!parsed.success) return <p role="alert">The generated screen could not be read.</p>;
  return <OpenGenerativeUIActivityRenderer activityType="open-generative-ui" agent={null} message={null} content={parsed.data} />;
}
