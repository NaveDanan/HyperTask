// Copied from t3code (apps/web/src/components/settings/SecretInput.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License.
// See src/shared/hyper-voice/NOTICE.md.
// Adapted for HyperTask by NaveDanan: only the controlled form the voice key dialog uses (no DraftInput commit mode).
import { useGT } from "../gt";
import { Input, type InputProps } from "../ui/input";

type SecretInputProps = Omit<InputProps, "type" | "autoComplete" | "defaultValue" | "value"> & {
  /** Pass only the replacement draft as `value`. */
  readonly configured?: boolean;
  readonly value: string;
};

export function SecretInput({ configured = false, placeholder, ...props }: SecretInputProps) {
  const gt = useGT();
  return (
    <Input
      {...props}
      type="password"
      autoComplete="off"
      spellCheck={false}
      placeholder={
        configured ? gt("Stored secret, enter a new value to replace") : (placeholder ?? gt("Not set"))
      }
    />
  );
}
