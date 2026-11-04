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

type Position = { commit: bigint; prepare: bigint };

export const accounts = readModel.collection<AccountDocument>("accounts");
export const transactions = readModel.collection<TransactionDocument>("transactions");
const checkpoints = readModel.collection<{ _id: string; commit: string; prepare: string }>("checkpoints");

export async function findCheckpoint(projector: string): Promise<Position | undefined> {
	const checkpoint = await checkpoints.findOne({ _id: projector });

	return checkpoint ? { commit: BigInt(checkpoint.commit), prepare: BigInt(checkpoint.prepare) } : undefined;
}

export async function saveCheckpoint(projector: string, { commit, prepare }: Position) {
	await checkpoints.updateOne({ _id: projector }, { $set: { commit: String(commit), prepare: String(prepare) } }, { upsert: true });
}
