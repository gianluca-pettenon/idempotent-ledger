import {
	balanceOf,
	decideDeposit,
	decideTransfer,
	decideWithdraw,
	LedgerError,
} from "@api/features/ledger/ledger.domain";
import {
	type AccountAppend,
	appendEvents,
	findProcessedRequest,
	loadAccount,
	registerUsers,
} from "@api/features/ledger/ledger.repository";

const DEFAULT_USERS = ["User A", "User B", "User C", "User D"];
const MAX_ATTEMPTS = 20;

type Request = { type: string; userId: string; toUserId?: string; amount: number };

type Decision = { appends: AccountAppend[]; balance: number };

// Read, decide, append; retry on optimistic-concurrency conflicts. With a key, the request is recorded
// in the same atomic append as its effect, so retries replay the first result instead of applying twice.
async function execute(request: Request, key: string | null, decide: () => Promise<Decision>) {
	const requestJson = JSON.stringify(request);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (key) {
			const previous = await findProcessedRequest(request.userId, key);

			if (previous) {
				if (previous.request !== requestJson) {
					throw new LedgerError(409, `Idempotency-Key "${key}" was already used with a different request`);
				}

				return { balance: previous.balance, outcome: "duplicate" };
			}
		}

		const { appends, balance } = await decide();
		const processed = key ? { userId: request.userId, key, request: requestJson, balance } : undefined;

		if (await appendEvents(appends, processed)) return { balance, outcome: "processed" };
	}

	throw new LedgerError(409, "Account is under heavy contention, retry later");
}

export function deposit(userId: string, amount: number, key: string | null) {
	return execute({ type: "deposit", userId, amount }, key, async () => {
		const account = await loadAccount(userId);
		const event = decideDeposit(amount);

		return { appends: [{ userId, revision: account.revision, event }], balance: account.balance + balanceOf([event]) };
	});
}

export function withdraw(userId: string, amount: number, key: string | null) {
	return execute({ type: "withdraw", userId, amount }, key, async () => {
		const account = await loadAccount(userId);
		const event = decideWithdraw(account, amount);

		return { appends: [{ userId, revision: account.revision, event }], balance: account.balance + balanceOf([event]) };
	});
}

export function transfer(fromUserId: string, toUserId: string, amount: number, key: string | null) {
	return execute({ type: "transfer", userId: fromUserId, toUserId, amount }, key, async () => {
		const [from, to] = await Promise.all([loadAccount(fromUserId), loadAccount(toUserId)]);
		const [sent, received] = decideTransfer(from, to, amount);

		return {
			appends: [
				{ userId: fromUserId, revision: from.revision, event: sent },
				{ userId: toUserId, revision: to.revision, event: received },
			],
			balance: from.balance + balanceOf([sent]),
		};
	});
}

export async function openAccounts(names: string[]) {
	const users = names.map((name) => ({ id: Bun.randomUUIDv7(), name }));
	await registerUsers(users, "any");

	return users;
}

// Seeds once: a second start finds the users stream and the append is rejected.
export function seedDefaultUsers() {
	return registerUsers(
		DEFAULT_USERS.map((name) => ({ id: Bun.randomUUIDv7(), name })),
		"no_stream",
	);
}
