import { bigintToSafeNumber } from "@api/features/ledger/money";

export function toPublicJson(value: unknown) {
	return JSON.parse(
		JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? bigintToSafeNumber(nested) : nested)),
	);
}
