const RequestHeader = {
	IdempotencyKey: "Idempotency-Key",
	RequestId: "X-Request-Id",
} as const;

export function readRequestMeta({ headers }: Request) {
	const idempotencyKey = headers.get(RequestHeader.IdempotencyKey)?.trim() || null;
	const requestId = headers.get(RequestHeader.RequestId)?.trim() || Bun.randomUUIDv7();

	return { idempotencyKey, requestId };
}
