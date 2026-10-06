// Recurso "Facturas" para @core/admin: solo lectura (las facturas no se editan), sustituir simplificada por completa
// y rectificar el total; enlace a la versión imprimible.
import { count, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminContext, AdminResource } from '../contracts/index.ts';
import { getDb } from '../db/index.ts';
import { InvoiceError, rectifyInFull, replaceSimplified } from './invoices.ts';
import { type Invoice, invoices } from './schema.ts';

async function need(ctx: AdminContext, p: string) {
  if (!(await ctx.can(p))) throw new InvoiceError('forbidden', `forbidden: ${p}`);
}
const ReplaceInput = z.object({ name: z.string().min(1).max(120), taxId: z.string().min(8).max(14), address: z.string().min(5).max(300), country: z.string().length(2).default('ES') });

export const invoicesAdminResource = (opts: { printPath?: (inv: Invoice) => string } = {}): AdminResource<Invoice> => ({
  name: 'invoices',
  label: { singular: 'Invoice', plural: 'Invoices' },
  group: 'Store',
  fields: [
    { name: 'number', label: 'Number', type: 'text', readOnly: true, list: true },
    { name: 'type', label: 'Type', type: 'text', readOnly: true, list: true },
    { name: 'issuedAt', label: 'Issued', type: 'datetime', readOnly: true, list: true },
    { name: 'total', label: 'Total', type: 'money', readOnly: true, list: true },
    { name: 'recipient', label: 'Recipient', type: 'json', readOnly: true },
    { name: 'lines', label: 'Lines', type: 'json', readOnly: true },
    { name: 'reason', label: 'Reason', type: 'text', readOnly: true },
  ],
  input: z.never(),
  title: (i) => i.number,
  async list(q, ctx) {
    await need(ctx, 'invoices:read');
    const where = q.search ? or(ilike(invoices.number, `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`), eq(invoices.orderId, q.search)) : undefined;
    const [total] = await getDb().select({ n: count() }).from(invoices).where(where);
    const rows = await getDb().select().from(invoices).where(where).orderBy(desc(invoices.issuedAt)).limit(q.pageSize).offset((Math.max(q.page, 1) - 1) * q.pageSize);
    return { rows, total: total?.n ?? 0 };
  },
  async get(id, ctx) {
    await need(ctx, 'invoices:read');
    const [r] = await getDb().select().from(invoices).where(eq(invoices.id, id));
    return r ?? null;
  },
  ...(opts.printPath && { links: (i: Invoice) => [{ label: 'Print / PDF', href: opts.printPath!(i) }] }),
  actions: [
    {
      name: 'replace',
      label: 'Issue full invoice (customer tax details)',
      permission: 'invoices:create',
      input: ReplaceInput,
      available: (i) => i.type === 'F2',
      async run(id, input, ctx) {
        await need(ctx, 'invoices:create');
        return replaceSimplified(id, ReplaceInput.parse(input));
      },
    },
    {
      name: 'rectify-total',
      label: 'Rectify in full (credit note)',
      permission: 'invoices:create',
      confirm: true,
      available: (i) => ['F1', 'F2', 'F3'].includes(i.type) && !!i.orderId,
      async run(id, _i, ctx) {
        await need(ctx, 'invoices:create');
        // Solo lo que quede sin rectificar (reembolsos anteriores ya tienen su rectificativa).
        return rectifyInFull(id);
      },
    },
  ],
});
