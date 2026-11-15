// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
export type ComponentRecord = {
  name: string;
  title: string;
  kind: string;
  draftDescription: string;
  publishedDescription: string | null;
  published: boolean;
  publishedAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
  /** The Bots held back from this. Every other Bot may answer with it. */
  withheldFrom: string[];
  /** The data functions this component may read. Empty means it draws only what the model hands it. */
  functions: string[];
};
export type GrantedComponent = {
  name: string;
  description: string;
};
export type DataFunctionSummary = {
  name: string;
  description: string;
  reads: string;
};
export type SandboxedRecord = {
  name: string;
  title: string;
  draftDescription: string;
  draftHtml: string;
  draftCss: string;
  draftJsFunctions: string;
  draftArgumentSchema: Record<string, unknown>;
  publishedHtml: string | null;
  publishedCss: string | null;
  publishedJsFunctions: string | null;
  publishedArgumentSchema: Record<string, unknown> | null;
  sampleArguments: Record<string, unknown>;
  revision: number;
  published: boolean;
  publishedAt: string | null;
  authoredBy: string | null;
  hasUnpublishedChanges: boolean;
};
export type PublishedSandboxed = {
  name: string;
  html: string;
  css: string;
  jsFunctions: string;
  /** What the model fills in. A tool with no parameters is called with no arguments. */
  argumentSchema: Record<string, unknown>;
};
export type SandboxedDraftInput = {
  slug: string;
  title: string;
  description: string;
  html: string;
  css: string;
  jsFunctions: string;
  argumentSchema: Record<string, unknown>;
  sampleArguments: Record<string, unknown>;
};
