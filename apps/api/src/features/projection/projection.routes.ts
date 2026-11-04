import { Elysia } from "elysia";
import { accounts, transactions } from "@api/features/projection/projection.store";

const RECENT_TRANSACTIONS = 20;

export const projectionRoutes = new Elysia()
	.get("/accounts", async () => ({
		data: await accounts.find({}, { projection: { _id: 0, id: "$_id", name: "$ownerName" } }).sort({ ownerName: 1 }).toArray(),
	}))
	.get("/accounts/:accountId", async ({ params: { accountId } }) => {
		const account = await accounts.findOne({ _id: accountId });

		if (!account) {
			throw new Error(`Account ${accountId} not found`, { cause: 404 });
		}

		const lines = await transactions
			.aggregate([
				{ $match: { accountId } },
				{ $sort: { version: -1 } },
				{ $limit: RECENT_TRANSACTIONS },
				{ $lookup: { from: "accounts", localField: "counterpartyAccountId", foreignField: "_id", as: "counterparty" } },
				{ $project: { _id: 0, id: "$_id", type: 1, amount: 1, createdAt: 1, counterpartyAccountId: 1, counterpartyName: { $first: "$counterparty.ownerName" } } },
			])
			.toArray();

		return { data: { balance: account.balance, transactions: lines } };
	});
