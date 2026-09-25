import { StatusMap } from "elysia";

export class IdempotencyKeyReusedError extends Error {
	status = StatusMap.Conflict;
}

export class IdempotencyRecordNotCompletedError extends Error {}
