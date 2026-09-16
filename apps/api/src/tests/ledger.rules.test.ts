import { describe, expect, test } from "bun:test";
import { InsufficientBalanceError, InvalidAmountError } from "@api/features/ledger/errors";
import {
	assertPositiveAmount,
	assertSufficientBalance,
	calculateNewBalance,
} from "@api/features/ledger/services/ledger.service";

describe("calculateNewBalance", () => {
	test("adds the amount when direction is 1", () => {
		expect(calculateNewBalance(1000, 250, 1)).toBe(1250);
	});

	test("subtracts the amount when direction is -1", () => {
		expect(calculateNewBalance(1000, 250, -1)).toBe(750);
	});

	test("allows the balance to land exactly on zero", () => {
		expect(calculateNewBalance(500, 500, -1)).toBe(0);
	});

	test("allows the balance to go negative (callers must check with assertSufficientBalance)", () => {
		expect(calculateNewBalance(100, 500, -1)).toBe(-400);
	});
});

describe("assertSufficientBalance", () => {
	test("does not throw when the new balance is positive", () => {
		expect(() => assertSufficientBalance("account-1", 100)).not.toThrow();
	});

	test("does not throw when the new balance is exactly zero", () => {
		expect(() => assertSufficientBalance("account-1", 0)).not.toThrow();
	});

	test("throws InsufficientBalanceError when the new balance is negative", () => {
		expect(() => assertSufficientBalance("account-1", -1)).toThrow(InsufficientBalanceError);
	});
});

describe("assertPositiveAmount", () => {
	test("does not throw for a positive amount", () => {
		expect(() => assertPositiveAmount(1)).not.toThrow();
	});

	test("throws InvalidAmountError for zero", () => {
		expect(() => assertPositiveAmount(0)).toThrow(InvalidAmountError);
	});

	test("throws InvalidAmountError for a negative amount", () => {
		expect(() => assertPositiveAmount(-100)).toThrow(InvalidAmountError);
	});
});
