import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/cn';

export type ButtonVariant = 'primary' | 'danger' | 'info' | 'outline';

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-primary text-primary-foreground hover:brightness-105',
  danger:
    'border-transparent bg-danger text-danger-foreground hover:brightness-105',
  info: 'border-transparent bg-info text-info-foreground hover:brightness-105',
  outline:
    'border-border bg-background/50 text-muted-foreground hover:border-ring/60 hover:bg-muted/80 hover:text-foreground',
};

export function Button({
  className,
  type = 'button',
  variant = 'outline',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium tracking-[-0.01em] transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-40',
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
