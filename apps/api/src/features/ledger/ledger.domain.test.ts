import { describe, expect, test } from "bun:test";
import { balanceOf, decideDeposit, decideTransfer, decideWithdraw, LedgerError } from "@api/features/ledger/ledger.domain";

const alice = { userId: "alice", balance: 50 };
const bob = { userId: "bob", balance: 0 };

describe("ledger domain", () => {
	test("balance is the fold of the events", () => {
		const [sent, received] = decideTransfer(alice, bob, 20);

		expect(balanceOf([decideDeposit(100), decideWithdraw({ ...alice, balance: 100 }, 30), sent])).toBe(50);
		expect(balanceOf([received])).toBe(20);
	});

	test("rejects invalid amounts, overdrafts and self transfers", () => {
		for (const amount of [0, -1, 1.5, Number.NaN]) expect(() => decideDeposit(amount)).toThrow(LedgerError);
		expect(() => decideWithdraw(alice, 51)).toThrow("insufficient balance");
		expect(() => decideTransfer(alice, alice, 1)).toThrow("same account");
	});
});
