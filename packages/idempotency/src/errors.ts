export class IdempotencyKeyReusedError extends Error {}

// Não deveria ser alcançável em uso normal: a reserva (INSERT) e a conclusão (UPDATE)
// de uma chave sempre acontecem dentro da mesma transação, então um concorrente só
// enxerga a linha depois que ela já foi completada (ou nunca a enxerga, se a
// transação vencedora deu rollback). Existe como rede de segurança do invariante.
export class IdempotencyRecordNotCompletedError extends Error {}
