import { db, type DbClient, users } from "@banking-ledger/db";
import { eq } from "drizzle-orm";

export class UsersRepository {
	constructor(private readonly client: DbClient = db) {}

	async findAll() {
		return this.client.select().from(users);
	}

	async findById(id: string) {
		const [user] = await this.client.select().from(users).where(eq(users.id, id));

		return user;
	}
}
