export type Page = { page: number; pageSize: number };

export function pageClause(p: Page, paramIndex: number): { sql: string; params: number[] } {
  return { sql: ` limit $${paramIndex} offset $${paramIndex + 1}`, params: [p.pageSize, (p.page - 1) * p.pageSize] };
}

export function paged<T>(items: T[], total: number, p: Page) {
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Escape LIKE wildcards in user-supplied search terms. */
export function likePrefix(q: string): string {
  return `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
