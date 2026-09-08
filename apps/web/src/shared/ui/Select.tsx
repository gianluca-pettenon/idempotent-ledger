import { cn } from '@/shared/lib/cn';

export type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
};

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  className,
  placeholder = 'Select...',
}: SelectProps) {
  const hasPlaceholder = placeholder.length > 0;

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={cn('input select-trigger min-w-[10rem]', className)}
    >
      {hasPlaceholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
