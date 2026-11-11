interface HyperKatexOptions {
  displayMode: boolean;
  output: 'mathml';
  strict: 'error';
  throwOnError: boolean;
  trust: boolean | ((context: unknown) => boolean);
  maxExpand: number;
  maxSize: number;
  macros: Record<string, string>;
}
declare const katex: { readonly version: string; renderToString(formula: string, options: HyperKatexOptions): string };
export default katex;
