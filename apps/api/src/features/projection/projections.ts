import {
	PersistentSubscriptionExistsError,
	persistentSubscriptionToAllSettingsFromDefaults,
	type RecordedEvent,
	RETRY,
	START,
	streamNameFilter,
} from "@kurrent/kurrentdb-client";
import type { AccountEvent } from "@api/features/ledger/ledger.events";
import { ACCOUNT_STREAM, store } from "@api/features/ledger/ledger.store";
import { balancesProjector } from "@api/features/projection/projectors/balances.projector";
import { statementsProjector } from "@api/features/projection/projectors/statements.projector";

export type Projector = {
	name: string;
	setup?: () => Promise<unknown>;
	project: (event: AccountEvent, recorded: RecordedEvent) => Promise<unknown>;
};

const PROJECTORS = [balancesProjector, statementsProjector];

async function createGroup(name: string) {
	try {
		await store.createPersistentSubscriptionToAll(name, persistentSubscriptionToAllSettingsFromDefaults({ startFrom: START }), {
			filter: streamNameFilter({ prefixes: [ACCOUNT_STREAM] }),
		});
	} catch (error) {
		if (!(error instanceof PersistentSubscriptionExistsError)) {
			throw error;
		}
	}
}

async function consume({ name, project }: Projector) {
	const subscription = store.subscribeToPersistentSubscriptionToAll(name);

	for await (const resolved of subscription) {
		try {
			await project(resolved.event as unknown as AccountEvent, resolved.event as RecordedEvent);
			await subscription.ack(resolved);
		} catch (error) {
			await subscription.nack(RETRY, String(error), resolved);
		}
	}
}

async function subscribe(projector: Projector) {
	await Promise.all([projector.setup?.(), createGroup(projector.name)]);
	await consume(projector);
}

export const startProjections = () => Promise.all(PROJECTORS.map(subscribe));

if (import.meta.main) {
	await startProjections();
}
