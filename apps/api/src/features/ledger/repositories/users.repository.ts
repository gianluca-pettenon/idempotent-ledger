import { db, type DbClient, users } from "@banking-ledger/db";

export class UsersRepository {
	constructor(private readonly client: DbClient = db) {}

	async findAll() {
		return this.client.select().from(users);
	}
}
