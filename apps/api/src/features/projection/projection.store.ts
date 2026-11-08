import { MongoClient } from "mongodb";

const readModel = new MongoClient(Bun.env.MONGODB_URL as string, { ignoreUndefined: true }).db();

type AccountDocument = { _id: string; ownerName: string };

type TransactionDocument = {
	_id: string;
	accountId: string;
	type: string;
	amount: number;
	counterpartyAccountId?: string;
	createdAt: Date;
	version: number;
};

export const accounts = readModel.collection<AccountDocument>("accounts");
export const transactions = readModel.collection<TransactionDocument>("transactions");
