import { db, type DbClient, outboxEvents } from "@banking-ledger/db";
import { and, eq, isNull } from "drizzle-orm";

type NewOutboxEvent = {
	aggregateId: string;
	eventType: string;
	payload: string;
};

export class OutboxRepository {
	constructor(private readonly client: DbClient = db) {}

	async insert(event: NewOutboxEvent) {
		const [created] = await this.client.insert(outboxEvents).values(event).returning();

		return created;
	}

	async markPublished(id: string) {
		const [published] = await this.client
			.update(outboxEvents)
			.set({ publishedAt: new Date() })
			.where(and(eq(outboxEvents.id, id), isNull(outboxEvents.publishedAt)))
			.returning();

		return published;
	}
}
