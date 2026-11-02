export { client, db } from "@db/client";
export type { DbClient } from "@db/client";
export {
  accountKind,
  accounts,
  entries,
  entryType,
  idempotencyKeys,
  outboxEvents,
  transactions,
  transactionStatus,
  transactionType,
  users,
} from "@db/schema";
