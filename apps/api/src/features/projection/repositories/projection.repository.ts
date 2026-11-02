import { MongoClient } from "mongodb";

const readModel = new MongoClient(Bun.env.MONGODB_URL as string, { ignoreUndefined: true }).db();

type AccountDocument = { _id: string; ownerName: string; balance: number; version: number };

type TransactionDocument = {
	_id: string;
	accountId: string;
	type: string;
	amount: number;
	counterpartyAccountId?: string;
	createdAt: Date;
	version: number;
};

type CheckpointDocument = { _id: string; commit: string; prepare: string };

// accounts is written only by the balances projector, transactions only by the statements projector.
const accounts = readModel.collection<AccountDocument>("accounts");
const transactions = readModel.collection<TransactionDocument>("transactions");
const checkpoints = readModel.collection<CheckpointDocument>("checkpoints");

export async function findCheckpoint(projector: string) {
	const checkpoint = await checkpoints.findOne({ _id: projector });

	return checkpoint && { commit: BigInt(checkpoint.commit), prepare: BigInt(checkpoint.prepare) };
}

export async function saveCheckpoint(projector: string, position: { commit: bigint; prepare: bigint }) {
	await checkpoints.updateOne(
		{ _id: projector },
		{ $set: { commit: String(position.commit), prepare: String(position.prepare) } },
		{ upsert: true },
	);
}

export async function insertAccount({ _id, ...account }: AccountDocument) {
	await accounts.updateOne({ _id }, { $setOnInsert: account }, { upsert: true });
}

// Moves only when the event is newer than the account's version, so a replayed event changes nothing.
export async function applyBalance(accountId: string, version: number, delta: number) {
	await accounts.updateOne({ _id: accountId, version: { $lt: version } }, { $inc: { balance: delta }, $set: { version } });
}

export function createTransactionIndexes() {
	return transactions.createIndex({ accountId: 1, version: -1 });
}

// Keyed by the event id, so a replayed event changes nothing.
export async function insertTransaction({ _id, ...transaction }: TransactionDocument) {
	await transactions.updateOne({ _id }, { $setOnInsert: transaction }, { upsert: true });
}

export async function findAccounts() {
	const documents = await accounts.find().sort({ ownerName: 1 }).toArray();

	return documents.map(({ _id, ownerName }) => ({ id: _id, name: ownerName }));
}

export function findAccount(accountId: string) {
	return accounts.findOne({ _id: accountId });
}

// The counterparty's name is joined at read time, so the statements projector never depends on the balances one.
export async function findRecentTransactions(accountId: string, limit: number) {
	const documents = await transactions
		.aggregate<TransactionDocument & { counterparty: AccountDocument[] }>([
			{ $match: { accountId } },
			{ $sort: { version: -1 } },
			{ $limit: limit },
			{ $lookup: { from: "accounts", localField: "counterpartyAccountId", foreignField: "_id", as: "counterparty" } },
		])
		.toArray();

	return documents.map(({ _id, type, amount, createdAt, counterpartyAccountId, counterparty }) => ({
		id: _id,
		type,
		amount,
		createdAt,
		counterpartyAccountId,
		counterpartyName: counterparty[0]?.ownerName,
	}));
}
