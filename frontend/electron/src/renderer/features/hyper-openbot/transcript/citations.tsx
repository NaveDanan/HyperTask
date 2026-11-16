// Copyright (c) 2026 CopilotKit. MIT license, see LICENSE.
import { File, FileText, Presentation, Table2 } from 'lucide-react';
import type { ReactNode } from 'react';
const DRIVE_KINDS = [
  { match: "/document/", icon: FileText, label: "Doc" },
  { match: "/spreadsheets/", icon: Table2, label: "Sheet" },
  { match: "/presentation/", icon: Presentation, label: "Slides" },
] as const;

export function hyperDocumentChipKind(href: string | undefined) {
  if (!href) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    // A relative or malformed href is not a recognised document, and is not worth throwing over.
    return null;
  }

  /*
   * Exact hosts, never a suffix test. `docs.google.com.evil.test` ends with the string and is
   * somebody else's domain, and a chip is a statement that this is a real file in a real connected
   * system — the one kind of link where dressing up an impostor does actual harm.
   */
  if (url.protocol !== "https:") return null;
  if (url.hostname === "docs.google.com") {
    const kind = DRIVE_KINDS.find((entry) =>
      url.pathname.includes(entry.match),
    );
    // A docs.google.com URL of some other shape is still a Drive document, just not one of the three.
    return kind ?? { match: "", icon: File, label: "Drive" };
  }
  if (url.hostname === "drive.google.com") {
    return { match: "", icon: File, label: "Drive" };
  }
  /*
   * Same exact-host rule as Drive: a chip asserts "this is a document in a system you have
   * connected", and notion.so.evil.test is somebody else's domain wearing the name.
   */
  if (url.hostname === "notion.so" || url.hostname === "www.notion.so") {
    return { match: "", icon: FileText, label: "Notion" };
  }
  return null;
}


export interface HyperCitationProps {
  href: string;
  children: ReactNode;
  onOpenLink?: (href: string) => void;
}
/** Only absolute HTTP(S) and mail links may leave model-generated content. */
export function hyperSafeHref(href: string): string | undefined {
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
export function HyperCitation({ href, children, onOpenLink }: HyperCitationProps) {
  const safe = hyperSafeHref(href);
  if (!safe) return <span>{children}</span>;
  const kind = hyperDocumentChipKind(safe);
  const Icon = kind?.icon;
  return <a href={safe} target="_blank" rel="noreferrer noopener"
    onClick={onOpenLink ? event => { event.preventDefault(); onOpenLink(safe); } : undefined}
    className={kind ? 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 align-middle text-xs leading-tight no-underline transition-colors hover:bg-muted' : 'underline underline-offset-2 hover:no-underline'}>
    {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
    <span className="truncate">{children}</span>
    {kind && <span className="shrink-0 text-muted-foreground">{kind.label}</span>}
  </a>;
}
