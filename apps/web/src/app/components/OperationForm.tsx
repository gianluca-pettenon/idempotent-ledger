import { OPERATION_KINDS, OperationKind } from '@banking-ledger/shared';
import { CONCURRENCY, FORM, OPERATION } from '@banking-ledger/terms';
import { RequestResults } from '@/app/components/RequestResults';
import type { Operation, RunEntry, User } from '@/app/lib/types';
import { Button, type ButtonVariant, Select } from '@/shared/ui';

type OperationFormProps = {
  operation: Operation;
  running: boolean;
  amount: string;
  toUserId: string;
  recipients: User[];
  entries: RunEntry[];
  onOperationChange: (operation: Operation) => void;
  onAmountChange: (value: string) => void;
  onToUserIdChange: (userId: string) => void;
  onRun: (withIdempotencyKey: boolean) => void;
};

const operationVariants = {
  [OperationKind.Deposit]: 'primary',
  [OperationKind.Withdraw]: 'danger',
  [OperationKind.Transfer]: 'info',
} as const satisfies Record<Operation, ButtonVariant>;

export function OperationForm({
  operation,
  running,
  amount,
  toUserId,
  recipients,
  entries,
  onOperationChange,
  onAmountChange,
  onToUserIdChange,
  onRun,
}: OperationFormProps) {
  const recipientOptions = recipients.map(({ id, name }) => ({
    value: id,
    label: name,
  }));

  return (
    <div className="panel px-5 py-6 sm:px-6 sm:py-6">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {CONCURRENCY.COMPARE_NOTE}
        </p>

        <div className="grid grid-cols-1 gap-2 min-[22rem]:grid-cols-3">
          {OPERATION_KINDS.map((kind) => (
            <Button
              key={kind}
              variant={operation === kind ? operationVariants[kind] : 'outline'}
              disabled={running}
              onClick={() => onOperationChange(kind)}
              className="w-full px-3 py-3"
            >
              {OPERATION[kind].label}
            </Button>
          ))}
        </div>

        {operation === OperationKind.Transfer ? (
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">{FORM.TO}</span>
            <Select
              value={toUserId}
              onChange={onToUserIdChange}
              options={recipientOptions}
              placeholder={FORM.CHOOSE_RECIPIENT}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">
            {FORM.AMOUNT_PER_REQUEST}
          </span>
          <input
            aria-label={FORM.AMOUNT_PER_REQUEST}
            autoComplete="off"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="input font-mono tabular-nums"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant={operationVariants[operation]}
            disabled={running}
            onClick={() => onRun(true)}
            className="w-full"
          >
            {running ? CONCURRENCY.RUNNING : CONCURRENCY.WITH_IDEMPOTENCY}
          </Button>
          <Button
            variant="outline"
            disabled={running}
            onClick={() => onRun(false)}
            className="w-full border-white/80 bg-transparent text-white hover:border-white hover:bg-white hover:!text-black active:bg-white/90 active:!text-black"
          >
            {running ? CONCURRENCY.RUNNING : CONCURRENCY.WITHOUT_PROTECTION}
          </Button>
        </div>

        <RequestResults entries={entries} />
      </div>
    </div>
  );
}
