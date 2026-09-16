import { describe, expect, test } from "bun:test";
import { readRequestMeta } from "@api/request-meta";

function requestWithHeaders(headers: Record<string, string>) {
	return new Request("http://localhost/api/accounts/1", { headers });
}

describe("readRequestMeta", () => {
	test("reads the idempotency key and request id from headers", () => {
		const meta = readRequestMeta(requestWithHeaders({ "Idempotency-Key": "abc", "X-Request-Id": "req-1" }));

		expect(meta).toEqual({ idempotencyKey: "abc", requestId: "req-1" });
	});

	test("trims surrounding whitespace from both headers", () => {
		const meta = readRequestMeta(requestWithHeaders({ "Idempotency-Key": "  abc  ", "X-Request-Id": "  req-1  " }));

		expect(meta).toEqual({ idempotencyKey: "abc", requestId: "req-1" });
	});

	test("returns null idempotencyKey when the header is missing", () => {
		const meta = readRequestMeta(requestWithHeaders({}));

		expect(meta.idempotencyKey).toBeNull();
	});

	test("returns null idempotencyKey when the header is blank", () => {
		const meta = readRequestMeta(requestWithHeaders({ "Idempotency-Key": "   " }));

		expect(meta.idempotencyKey).toBeNull();
	});

	test("generates a requestId when the header is missing", () => {
		const meta = readRequestMeta(requestWithHeaders({}));

		expect(typeof meta.requestId).toBe("string");
		expect(meta.requestId.length).toBeGreaterThan(0);
	});

	test("generates a requestId when the header is blank", () => {
		const meta = readRequestMeta(requestWithHeaders({ "X-Request-Id": "   " }));

		expect(meta.requestId.trim().length).toBeGreaterThan(0);
	});
});
