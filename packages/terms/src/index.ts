export const APP = {
  TITLE: 'Banking Ledger',
} as const;

export const ACCOUNT = {
  LABEL: 'Account',
  BALANCE_LABEL: 'Your balance',
  SELECT_TO_VIEW_BALANCE: 'Select an account to view balance.',
  SELECT_TO_VIEW_TRANSACTIONS: 'Select an account to view transactions.',
  SELECT_ACCOUNT: 'Select an account',
} as const;

export const UI = {
  CLOSE_DRAWER: 'Close drawer',
} as const;

export const FORM = {
  AMOUNT: 'Amount',
  AMOUNT_PER_REQUEST: 'Amount per request',
  TO: 'To',
  NO_RECIPIENTS: 'No recipients',
  CHOOSE_RECIPIENT: 'Choose recipient',
  ERRORS: {
    NO_ACCOUNT: 'Select an account.',
    INVALID_AMOUNT: 'Enter a valid amount.',
    NO_RECIPIENT: 'Select a recipient.',
  },
} as const;

export const CONCURRENCY = {
  DRAWER: {
    TITLE: 'Concurrency lab',
    DESCRIPTION: 'Simulate retries and see how idempotency protects the ledger.',
  },
  COMPARE_NOTE: 'Compare protected vs unprotected behavior.',
  OPERATION: 'Operation',
  RUNNING: 'Running...',
  WITH_IDEMPOTENCY: 'With Idempotency',
  WITHOUT_PROTECTION: 'Without Protection',
  RUN_SCENARIO: 'Run a scenario',
  RUN_SCENARIO_HINT:
    'Pick deposit, withdraw, or transfer — then see how many requests were sent, processed, or deduplicated.',
  REJECTED:
    'Rejected by the ledger (e.g. insufficient balance).',
  STATS: {
    SENT: 'Sent',
    PROCESSED: 'Processed',
    DEDUPED: 'Deduped',
  },
  TABLE: {
    REQ: 'Req',
    OUTCOME: 'Outcome',
    DETAIL: 'Detail',
    TIME: 'Time',
  },
  OPERATIONS: {
    DEPOSIT: {
      LABEL: 'Deposit',
      DESCRIPTION:
        'Fires three deposit requests at once — like retries after a timeout or a double-click.',
    },
    WITHDRAW: {
      LABEL: 'Withdraw',
      DESCRIPTION:
        'Fires three withdraw requests at once. Without idempotency, each retry debits the ledger again.',
    },
    TRANSFER: {
      LABEL: 'Transfer',
      DESCRIPTION:
        'Fires three transfers to the same recipient at once. Idempotency keeps only one pair of ledger entries.',
    },
  },
  SUMMARY: {
    DEDUPLICATED: (sent: number, duplicate: number) =>
      `${sent} requests sent · 1 processed · ${duplicate} deduplicated`,
    DEDUPLICATED_DETAIL:
      'Same idempotency key + serial ledger writes: only one entry was applied.',
    ALL_PROCESSED: (sent: number, processed: number) =>
      `${sent} requests sent · ${processed} processed · 0 deduplicated`,
    ALL_PROCESSED_DETAIL:
      'Without idempotency keys, each retry becomes a separate ledger entry.',
    WITH_FAILURES: (sent: number, processed: number, failed: number) =>
      `${sent} requests sent · ${processed} processed · ${failed} failed`,
    WITH_FAILURES_DETAIL: 'Some requests could not be applied to the ledger.',
    DEFAULT: (sent: number) => `${sent} requests sent`,
    DEFAULT_DETAIL: 'Each request was handled independently.',
  },
} as const;

export const OPERATION = {
  deposit: { label: CONCURRENCY.OPERATIONS.DEPOSIT.LABEL },
  withdraw: { label: CONCURRENCY.OPERATIONS.WITHDRAW.LABEL },
  transfer: { label: CONCURRENCY.OPERATIONS.TRANSFER.LABEL },
} as const;

export const TRANSACTION = {
  DEPOSIT: {
    TITLE: 'Deposit',
    SUBMIT: 'Deposit',
    PENDING: 'Depositing...',
    FAILED: 'Deposit failed.',
  },
  WITHDRAW: {
    TITLE: 'Withdraw',
    SUBMIT: 'Withdraw',
    PENDING: 'Withdrawing...',
    FAILED: 'Withdrawal failed.',
  },
  TRANSFER: {
    TITLE: 'Transfer',
    SUBMIT: 'Transfer',
    PENDING: 'Transferring...',
    FAILED: 'Transfer failed.',
  },
} as const;

export const STATEMENT = {
  TITLE: 'Statement',
  EMPTY: 'No transactions yet.',
  COLUMNS: {
    DATE: 'Date',
    DESCRIPTION: 'Description',
    AMOUNT: 'Amount',
  },
  BADGE: {
    DEPOSIT: 'Deposit',
    WITHDRAWAL: 'Withdrawal',
    RECEIVED: 'Received',
    SENT: 'Sent',
  },
  OUTGOING_TRANSFER: 'Outgoing transfer',
  INCOMING_TRANSFER: 'Incoming transfer',
  transferTo: (name: string) => `Transfer to ${name}`,
  transferFrom: (name: string) => `Transfer from ${name}`,
} as const;

export const LEDGER = {
  ERRORS: {
    ACCOUNT_NOT_FOUND: 'Account not found',
    INVALID_TRANSACTION_TYPE: 'Invalid transaction type',
    INVALID_AMOUNT: 'Invalid amount',
    INSUFFICIENT_BALANCE: 'Insufficient balance',
    SAME_ACCOUNT_TRANSFER: 'Cannot transfer to the same account',
    MISSING_USER_IDS: 'Missing user ids',
    TRANSACTION_FAILED: 'Transaction failed',
    TRANSFER_FAILED: 'Transfer failed',
  },
  MESSAGES: {
    APPLIED: 'Applied to the ledger.',
    DUPLICATE_EARLY:
      'Idempotent replay — this request matches one already applied to the ledger.',
    DUPLICATE_RACE:
      'Idempotent replay — a concurrent duplicate finished first.',
  },
} as const;
