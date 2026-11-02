import { type RecordedEvent, START, streamNameFilter } from "@kurrent/kurrentdb-client";
import type { AccountEvent } from "@api/features/ledger/domain/ledger.domain";
import { StreamPrefix } from "@api/features/ledger/domain/ledger.events";
import { store } from "@api/features/ledger/repositories/ledger.repository";
import {
	findAccount,
	findAccounts,
	findCheckpoint,
	findRecentTransactions,
	saveCheckpoint,
} from "@api/features/projection/repositories/projection.repository";

const RECENT_TRANSACTIONS = 20;

export enum ProjectorName {
	Balances = "balances",
	Statements = "statements",
}

// One read-model view. Each projector is its own process with its own checkpoint,
// so it can fail, be rebuilt or be deployed without touching the others.
export type Projector = {
	name: ProjectorName;
	setup?: () => Promise<unknown>;
	project: (event: AccountEvent, recorded: RecordedEvent) => Promise<void>;
};

// Catch-up subscription on $all. Projection writes are idempotent, so a crash between an event
// and its checkpoint only replays that event, harmlessly.
export async function runProjector({ name, setup, project }: Projector) {
	await setup?.();

	const subscription = store.subscribeToAll({
		fromPosition: (await findCheckpoint(name)) ?? START,
		filter: streamNameFilter({ prefixes: [StreamPrefix.Account] }),
	});

	for await (const { event } of subscription) {
		if (!event?.position) {
			continue;
		}

		await project({ type: event.type, data: event.data } as AccountEvent, event);
		await saveCheckpoint(name, event.position);
	}
}

export function listAccounts() {
	return findAccounts();
}

export async function getAccount(accountId: string) {
	const account = await findAccount(accountId);

	if (!account) {
		throw new Error(`Account ${accountId} not found`, { cause: 404 });
	}

	return { balance: account.balance, transactions: await findRecentTransactions(accountId, RECENT_TRANSACTIONS) };
}
