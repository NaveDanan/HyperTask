// The cloud provider logos of t3code's Voice settings (CloudSpeechLogo in apps/web/src/components/settings/
// VoiceSettingsPanel.tsx, which draws them with ProviderInstanceIcon and ProviderPackageIcon). The marks are copied
// from apps/web/src/components/Icons.tsx (OpenAI), packages/client-runtime/src/providerClients.ts (OpenRouter) and
// packages/provider-grok/src/client.ts (Grok). Copyright (c) 2026 T3 Tools Inc., MIT License.
// See src/shared/hyper-voice/NOTICE.md. The logos themselves belong to their companies.
import type { CSSProperties } from "react";
import type { CloudSpeechProvider } from "@shared/hyper-voice/speech";

import { cn } from "../ui/lib";

const OPENAI_PATH =
  "M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z";

/** ProviderPackageIcon's shape: one or more paths filled per theme. */
const PACKAGE_ICONS = {
  openrouter: {
    viewBox: "0 0 1024 730",
    fill: { light: "#03080A", dark: "#FCFCFE" },
    paths: [
      "M795.893 0C915.776 0 1012.95 97.9963 1012.95 218.88C1012.95 339.764 915.776 437.76 795.893 437.76L1011.2 654.869C1038.55 682.447 1019.18 729.6 980.504 729.6H361.77C161.97 729.6 0 566.273 0 364.8C0 163.327 161.97 0 361.77 0L795.893 0ZM361.77 145.92C241.89 145.92 144.708 243.916 144.708 364.8C144.708 485.684 241.89 583.68 361.77 583.68C481.649 583.68 578.831 485.684 578.831 364.8C578.831 243.916 481.649 145.92 361.77 145.92Z",
    ],
  },
  xai: {
    viewBox: "0 0 24 24",
    fill: { light: "#0F0F0F", dark: "#F5F5F5" },
    paths: [
      "M9.26905 15.284L17.2479 9.36086C17.6391 9.07047 18.1981 9.18374 18.3845 9.63478C19.3655 12.0135 18.9272 14.8721 16.9755 16.8349C15.0238 18.7976 12.3082 19.228 9.8261 18.2477L7.1146 19.5102C11.0037 22.1834 15.7263 21.5223 18.6774 18.5525C21.0182 16.1985 21.7432 12.9897 21.0653 10.0961L21.0714 10.1023C20.0884 5.85143 21.3131 4.15233 23.8218 0.677913C23.8812 0.595532 23.9406 0.513151 24 0.428711L20.6987 3.74866V3.73836L9.267 15.2861",
      "M7.62249 16.7237C4.83113 14.0422 5.3124 9.89222 7.69417 7.49905C9.45541 5.72786 12.341 5.00497 14.86 6.06768L17.5653 4.81138C17.0779 4.45714 16.4533 4.07613 15.7365 3.80839C12.4966 2.46764 8.6178 3.13492 5.98413 5.78141C3.45081 8.32904 2.65415 12.2463 4.02219 15.5889C5.04412 18.0871 3.36889 19.8541 1.68137 21.6377C1.08337 22.2699 0.483318 22.9022 0 23.5716L7.62045 16.7257",
    ],
  },
} as const;

export function CloudSpeechLogo({ provider }: { provider: CloudSpeechProvider }) {
  if (provider === "openai")
    // ProviderInstanceIcon for the codex driver: the OpenAI mark in the text color.
    return (
      <span className="relative isolate z-30 inline-flex shrink-0 items-center justify-center overflow-visible">
        <svg
          aria-hidden
          preserveAspectRatio="xMidYMid"
          viewBox="100 100 411 411"
          className="size-4 fill-current text-black dark:text-white"
        >
          <path fillRule="evenodd" clipRule="evenodd" d={OPENAI_PATH} />
        </svg>
      </span>
    );
  const icon = PACKAGE_ICONS[provider];
  const svg = (
    <svg
      aria-hidden
      viewBox={icon.viewBox}
      fill="none"
      data-provider-package-icon
      className={cn(
        "fill-(--icon-light) dark:fill-(--icon-dark)",
        provider === "openrouter" ? "size-4 shrink-0" : "size-4",
      )}
      style={{ "--icon-light": icon.fill.light, "--icon-dark": icon.fill.dark } as CSSProperties}
    >
      {icon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
  if (provider === "openrouter") return svg;
  // Grok is drawn by ProviderInstanceIcon, which wraps the package icon.
  return (
    <span className="relative isolate z-30 inline-flex shrink-0 items-center justify-center overflow-visible">
      {svg}
    </span>
  );
}
