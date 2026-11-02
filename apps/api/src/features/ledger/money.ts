import { InsufficientBalanceError, InvalidAmountError } from "@api/features/ledger/errors";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function assertPositiveAmount(amount: bigint) {
	if (amount <= 0n) {
		throw new InvalidAmountError("Amount must be greater than zero");
	}
}

export function assertSufficientBalance(accountId: string, newBalance: bigint) {
	if (newBalance < 0n) {
		throw new InsufficientBalanceError(`Account ${accountId} has insufficient balance`);
	}
}

export function entryDelta(kind: "customer" | "settlement", type: "debit" | "credit", amount: bigint) {
	const increases = kind === "customer" ? type === "credit" : type === "debit";
	return increases ? amount : -amount;
}

export function parseJsonAmount(value: number) {
	if (!Number.isSafeInteger(value)) {
		throw new InvalidAmountError(
			"Amount must be a safe integer. Fractional and oversized JSON numbers are rejected at the HTTP boundary",
		);
	}

	return BigInt(value);
}

export function bigintToSafeNumber(value: bigint) {
	if (value > MAX_SAFE || value < -MAX_SAFE) {
		throw new InvalidAmountError(
			"Monetary value exceeds Number.MAX_SAFE_INTEGER and cannot cross the JSON boundary without precision loss",
		);
	}

	return Number(value);
}
