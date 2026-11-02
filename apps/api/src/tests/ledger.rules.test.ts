import { describe, expect, test } from "bun:test";
import { InsufficientBalanceError, InvalidAmountError } from "@api/features/ledger/errors";
import { assertPositiveAmount, assertSufficientBalance } from "@api/features/ledger/services/ledger.service";

describe("assertSufficientBalance", () => {
	test("does not throw when the new balance is positive", () => {
		expect(() => assertSufficientBalance("account-1", 100n)).not.toThrow();
	});

	test("does not throw when the new balance is exactly zero", () => {
		expect(() => assertSufficientBalance("account-1", 0n)).not.toThrow();
	});

	test("throws InsufficientBalanceError when the new balance is negative", () => {
		expect(() => assertSufficientBalance("account-1", -1n)).toThrow(InsufficientBalanceError);
	});
});

describe("assertPositiveAmount", () => {
	test("does not throw for a positive amount", () => {
		expect(() => assertPositiveAmount(1n)).not.toThrow();
	});

	test("throws InvalidAmountError for zero", () => {
		expect(() => assertPositiveAmount(0n)).toThrow(InvalidAmountError);
	});

	test("throws InvalidAmountError for a negative amount", () => {
		expect(() => assertPositiveAmount(-100n)).toThrow(InvalidAmountError);
	});
});
