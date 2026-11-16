import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';

/** A searchable endpoint catalogue that also accepts unpublished or manually entered IDs. */
export function HyperEndpointModelInput({ id, value, models, disabled, onChange }: {
  id: string;
  value: string;
  models: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Combobox
      items={models}
      value={models.includes(value) ? value : null}
      inputValue={value}
      disabled={disabled}
      onInputValueChange={(next, details) => { if (details.reason === 'input-change') onChange(next); }}
      onValueChange={(next) => { if (typeof next === 'string') onChange(next); }}
    >
      <ComboboxInput id={id} disabled={disabled} spellCheck={false} autoComplete="off" className="w-full" />
      <ComboboxContent>
        <ComboboxEmpty>No matching models. You can enter a model ID manually.</ComboboxEmpty>
        <ComboboxList>
          {(model: string) => <ComboboxItem key={model} value={model} className="break-all">{model}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
