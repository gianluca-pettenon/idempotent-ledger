import { store } from "@api/features/ledger/repositories/ledger.repository";
import { createAccount } from "@api/features/ledger/services/ledger.service";

const DEFAULT_ACCOUNTS = ["User A", "User B", "User C", "User D"];

// Fixed namespace so each default account always gets the same id.
const SEED_NAMESPACE = "3c9e7f1a-5b2d-4e8f-a6c0-9d1b4f7e2a53";

// Fixed ids make reruns safe: the domain refuses to create an existing account (409), which the seed skips.
export function seed() {
	return Promise.all(
		DEFAULT_ACCOUNTS.map((ownerName) =>
			createAccount(Bun.randomUUIDv5(ownerName, SEED_NAMESPACE), ownerName).catch((error) => {
				if (error.cause !== 409) {
					throw error;
				}
			}),
		),
	);
}

if (import.meta.main) {
	await seed();
	await store.dispose();
}
