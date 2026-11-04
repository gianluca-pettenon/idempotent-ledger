import { type RecordedEvent, START, streamNameFilter } from "@kurrent/kurrentdb-client";
import type { AccountEvent } from "@api/features/ledger/ledger.events";
import { ACCOUNT_STREAM, store } from "@api/features/ledger/ledger.store";
import { findCheckpoint, saveCheckpoint } from "@api/features/projection/projection.store";

export type Projector = {
	name: string;
	project: (event: AccountEvent, recorded: RecordedEvent) => Promise<unknown>;
};

// Each projector is its own process with its own checkpoint. Its writes are idempotent,
// so a crash between an event and its checkpoint only replays that event, harmlessly.
export async function runProjector({ name, project }: Projector) {
	const subscription = store.subscribeToAll({
		fromPosition: (await findCheckpoint(name)) ?? START,
		filter: streamNameFilter({ prefixes: [ACCOUNT_STREAM] }),
	});

	for await (const { event } of subscription) {
		if (event?.position) {
			await project(event as unknown as AccountEvent, event);
			await saveCheckpoint(name, event.position);
		}
	}
}
