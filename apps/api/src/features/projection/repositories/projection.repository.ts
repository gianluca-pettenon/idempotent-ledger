import { MongoClient } from "mongodb";

const readModel = new MongoClient(Bun.env.MONGODB_URL as string, { ignoreUndefined: true }).db();

type AccountDocument = { _id: string; ownerName: string; balance: number; version: number };

export type TransactionDocument = {
	_id: string;
	accountId: string;
	type: string;
	amount: number;
	counterpartyAccountId?: string;
	counterpartyName?: string;
	createdAt: Date;
	version: number;
};

type CheckpointDocument = { _id: string; commit: string; prepare: string };

const accounts = readModel.collection<AccountDocument>("accounts");
const transactions = readModel.collection<TransactionDocument>("transactions");
const checkpoints = readModel.collection<CheckpointDocument>("checkpoints");

const PROJECTOR = "accounts";

export function createIndexes() {
	return transactions.createIndex({ accountId: 1, version: -1 });
}

export async function findCheckpoint() {
	const checkpoint = await checkpoints.findOne({ _id: PROJECTOR });

	return checkpoint && { commit: BigInt(checkpoint.commit), prepare: BigInt(checkpoint.prepare) };
}

export async function saveCheckpoint(position: { commit: bigint; prepare: bigint }) {
	await checkpoints.updateOne(
		{ _id: PROJECTOR },
		{ $set: { commit: String(position.commit), prepare: String(position.prepare) } },
		{ upsert: true },
	);
}

export async function insertAccount({ _id, ...account }: AccountDocument) {
	await accounts.updateOne({ _id }, { $setOnInsert: account }, { upsert: true });
}

// Both writes are idempotent: the transaction is keyed by the event id, and the balance only moves
// when the event is newer than the account's version. Replaying an event after a crash changes nothing.
export async function applyMovement({ _id, ...transaction }: TransactionDocument, delta: number) {
	await transactions.updateOne({ _id }, { $setOnInsert: transaction }, { upsert: true });
	await accounts.updateOne(
		{ _id: transaction.accountId, version: { $lt: transaction.version } },
		{ $inc: { balance: delta }, $set: { version: transaction.version } },
	);
}

export async function findOwnerName(accountId: string) {
	return (await accounts.findOne({ _id: accountId }))?.ownerName;
}

export async function findAccounts() {
	const documents = await accounts.find().sort({ ownerName: 1 }).toArray();

	return documents.map(({ _id, ownerName }) => ({ id: _id, name: ownerName }));
}

export function findAccount(accountId: string) {
	return accounts.findOne({ _id: accountId });
}

export async function findRecentTransactions(accountId: string, limit: number) {
	const documents = await transactions.find({ accountId }).sort({ version: -1 }).limit(limit).toArray();

	return documents.map(({ _id, type, amount, createdAt, counterpartyAccountId, counterpartyName }) => ({
		id: _id,
		type,
		amount,
		createdAt,
		counterpartyAccountId,
		counterpartyName,
	}));
}
