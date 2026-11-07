import {
  AMOUNT_PLACEHOLDER,
  CURRENCY,
  DISPLAY_LOCALE,
} from '@banking-ledger/shared';

export function formatUsd(value: number) {
  return value.toLocaleString(DISPLAY_LOCALE, {
    style: 'currency',
    currency: CURRENCY,
  });
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(DISPLAY_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export { AMOUNT_PLACEHOLDER };
