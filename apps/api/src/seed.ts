import { store } from "@api/features/ledger/repositories/ledger.repository";
import { createAccount } from "@api/features/ledger/services/ledger.service";

const DEFAULT_ACCOUNTS = ["User A", "User B", "User C", "User D"];

// Each name doubles as the Idempotency-Key, so running the seed again opens nothing new.
export function seed() {
	return Promise.all(DEFAULT_ACCOUNTS.map((ownerName) => createAccount(ownerName, `seed-${ownerName}`)));
}

if (import.meta.main) {
	await seed();
	await store.dispose();
}
