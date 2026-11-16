// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { z } from "zod";
import type { HyperGalleryComponent } from "./HyperGalleryRegistry";
import { HyperGalleryFrame } from "./frame";
import { HyperGalleryMarkdown } from "./markdown";

export const HyperQuoteCardProps = z.object({
  quote: z
    .string()
    .describe("The quotation itself, without surrounding quote marks"),
  attribution: z
    .string()
    .describe(
      "Who said or wrote it, e.g. 'Grace Hopper' or 'the 2026 annual report'",
    ),
  context: z
    .string()
    .optional()
    .describe(
      "One short line of context: where it is from, or why it matters here",
    ),
});

type QuoteArgs = z.infer<typeof HyperQuoteCardProps>;

export function HyperQuoteCard({ quote, attribution, context }: Partial<QuoteArgs>) {
  if (!quote) {
    return (
      <HyperGalleryFrame title="Quotation">
        <p className="text-sm text-muted-foreground">
          There is nothing to quote.
        </p>
      </HyperGalleryFrame>
    );
  }

  return (
    <HyperGalleryFrame caption={context} title="Quotation">
      <blockquote className="border-l-2 border-border pl-4">
        <HyperGalleryMarkdown className="text-sm leading-relaxed">
          {quote}
        </HyperGalleryMarkdown>
        {attribution ? (
          <footer className="mt-2 text-xs text-muted-foreground">
            {attribution}
          </footer>
        ) : null}
      </blockquote>
    </HyperGalleryFrame>
  );
}

export const GALLERY: HyperGalleryComponent[] = [
  {
    name: "showQuote",
    title: "Quotation",
    kind: "card",
    summary: "Shows a quotation and who said or wrote it.",
    description:
      "Show a quotation with its attribution. Use when the exact words matter, something a person said, or a line from a document you were given.",
    parameters: HyperQuoteCardProps,
    Component: HyperQuoteCard as HyperGalleryComponent["Component"],
    preview: {
      quote:
        "Meals under $75 need no receipt. Anything above needs one, and anything above $500 needs your manager before you spend it.",
      attribution: "the expense policy",
      context: "Last changed in March.",
    },
    confirmation: "The quotation is now on screen for the person.",
  },
];
