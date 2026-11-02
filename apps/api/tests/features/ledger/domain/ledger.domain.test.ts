import { describe, expect, test } from "bun:test";
import {
	balanceOf,
	decideDeposit,
	decideTransfer,
	decideWithdraw,
} from "@api/features/ledger/domain/ledger.domain";

const alice = { accountId: "alice", opened: true, balance: 50 };
const bob = { accountId: "bob", opened: true, balance: 0 };
const ghost = { accountId: "ghost", opened: false, balance: 0 };

describe("ledger domain", () => {
	test("balance is the fold of the events", () => {
		const [sent, received] = decideTransfer(alice, bob, 20, "t1");

		expect(balanceOf([decideDeposit(alice, 100), decideWithdraw({ ...alice, balance: 100 }, 30), sent])).toBe(50);
		expect(balanceOf([received])).toBe(20);
	});

	test("events carry the account they belong to", () => {
		const [sent, received] = decideTransfer(alice, bob, 20, "t1");

		expect(decideDeposit(alice, 10).data).toEqual({ accountId: "alice", amount: 10 });
		expect(sent.data).toMatchObject({ accountId: "alice", transferId: "t1", counterpartyAccountId: "bob", amount: 20 });
		expect(received.data).toMatchObject({ accountId: "bob", transferId: "t1", counterpartyAccountId: "alice", amount: 20 });
	});

	test("rejects invalid amounts, overdrafts and self transfers", () => {
		for (const amount of [0, -1, 1.5, Number.NaN]) expect(() => decideDeposit(alice, amount)).toThrow("positive integer");
		expect(() => decideWithdraw(alice, 51)).toThrow("insufficient balance");
		expect(() => decideTransfer(alice, alice, 1, "t1")).toThrow("same account");
	});

	test("money moves only on an existing account", () => {
		expect(() => decideDeposit(ghost, 10)).toThrow("not found");
		expect(() => decideTransfer(alice, ghost, 10, "t1")).toThrow("not found");
	});
});
