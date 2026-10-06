// Emisión de facturas españolas: numeración correlativa por serie y año, simplificada o completa según el importe,
// rectificativas por diferencias en reembolsos, sustitución de simplificadas por completas y registro encadenado.
// Las facturas nunca se borran ni se editan: se corrigen con rectificativas.
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Executor, getDb, withTransaction } from '../db/index.ts';
import { getOrder, onOrderEvent, type OrderDetail } from '../orders/index.ts';
import { type Invoice, type InvoiceLine, invoiceCounters, invoiceRecords, invoices, type Party } from './schema.ts';
import { type AltaFields, amountText, huella, madridTimestamp, qrUrl, spanishDate } from './verifactu.ts';

export class InvoiceError extends Error {
  constructor(
    readonly code: 'invalid' | 'not_found' | 'invalid_state' | 'config' | 'forbidden',
    message: string = code,
  ) {
    super(message);
  }
}

/** Emisor desde el entorno: `INVOICE_ISSUER_NIF`, `INVOICE_ISSUER_NAME`, `INVOICE_ISSUER_ADDRESS`. */
export function issuer(): Party & { taxId: string } {
  const taxId = process.env.INVOICE_ISSUER_NIF?.trim().toUpperCase();
  const name = process.env.INVOICE_ISSUER_NAME?.trim();
  if (!taxId || !/^[A-Z0-9]{9}$/.test(taxId) || !name) throw new InvoiceError('config', 'set INVOICE_ISSUER_NIF (9 characters) and INVOICE_ISSUER_NAME');
  return { name, taxId, address: process.env.INVOICE_ISSUER_ADDRESS?.trim() || null, country: 'ES' };
}

const vatRate = () => Number(process.env.INVOICE_VAT_RATE ?? 21);
/** Límite de la factura simplificada (IVA incluido): 400 € en general; 3000 € en comercio minorista (`INVOICE_RETAIL=1`). */
export const simplifiedLimit = () => (process.env.INVOICE_RETAIL === '1' ? 300_000 : 40_000);
const series = (rectifying: boolean) => {
  const s = (process.env.INVOICE_SERIES ?? 'A').toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(s)) throw new InvoiceError('config', 'INVOICE_SERIES must be 1–6 letters or digits');
  // Las rectificativas van en serie propia (obligatorio).
  return rectifying ? `${s}R` : s;
};

/** Base e IVA desde un total con IVA incluido (redondeo al céntimo; base + IVA = total). */
export function split(totalWithVat: number, rate = vatRate()): { base: number; vat: number } {
  const base = Math.round((totalWithVat * 100) / (100 + rate));
  return { base, vat: totalWithVat - base };
}

/** Siguiente número correlativo de la serie en el año, con la fila del contador bloqueada (sin huecos ni duplicados). */
async function nextNumber(tx: Executor, s: string, year: number): Promise<string> {
  await tx.insert(invoiceCounters).values({ series: s, year, last: 0 }).onConflictDoNothing();
  const [c] = await tx.select().from(invoiceCounters).where(and(eq(invoiceCounters.series, s), eq(invoiceCounters.year, year))).for('update');
  const n = c!.last + 1;
  await tx.update(invoiceCounters).set({ last: n }).where(and(eq(invoiceCounters.series, s), eq(invoiceCounters.year, year)));
  return `${s}${year}-${String(n).padStart(6, '0')}`;
}

/** Registro de alta encadenado al último del emisor (bloquea la cadena para que dos emisiones no compartan anterior). */
async function chainAlta(tx: Executor, inv: Invoice): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoices:${inv.issuer.taxId}`}))`);
  const [prev] = await tx.select().from(invoiceRecords).where(eq(invoiceRecords.issuerTaxId, inv.issuer.taxId!)).orderBy(desc(invoiceRecords.seq)).limit(1);
  const fields: AltaFields = {
    IDEmisorFactura: inv.issuer.taxId!,
    NumSerieFactura: inv.number,
    FechaExpedicionFactura: spanishDate(inv.issuedAt),
    TipoFactura: inv.type,
    CuotaTotal: amountText(inv.vat),
    ImporteTotal: amountText(inv.total),
    Huella: prev?.huella ?? '',
    FechaHoraHusoGenRegistro: madridTimestamp(new Date()),
  };
  await tx.insert(invoiceRecords).values({
    invoiceId: inv.id,
    issuerTaxId: inv.issuer.taxId!,
    seq: (prev?.seq ?? 0) + 1,
    kind: 'alta',
    huella: await huella(fields),
    previousHuella: prev?.huella ?? null,
    generatedAt: fields.FechaHoraHusoGenRegistro,
    fields,
  });
}

const Recipient = z.object({ name: z.string().trim().min(1).max(120), taxId: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,14}$/), address: z.string().trim().min(5).max(300), country: z.string().length(2).default('ES') });

type Draft = { type: Invoice['type']; orderId: string | null; rectifiesId?: string | null; reason?: string | null; recipient: Party | null; lines: InvoiceLine[]; currency: string; total: number };

async function issue(tx: Executor, d: Draft): Promise<Invoice> {
  if (d.currency !== 'EUR') throw new InvoiceError('invalid', 'Spanish invoices are issued in EUR (convert before issuing)');
  const now = new Date();
  const rate = vatRate();
  const { base, vat } = split(d.total, rate);
  const number = await nextNumber(tx, series(d.type.startsWith('R')), Number(spanishDate(now).slice(6)));
  const [inv] = await tx
    .insert(invoices)
    .values({ number, series: number.replace(/\d{4}-\d+$/, ''), type: d.type, issuedAt: now, orderId: d.orderId, rectifiesId: d.rectifiesId ?? null, reason: d.reason ?? null, issuer: issuer(), recipient: d.recipient, lines: d.lines, currency: d.currency, base, vatRate: rate, vat, total: d.total })
    .returning();
  await chainAlta(tx, inv!);
  return inv!;
}

const tx = <T>(db: Executor, fn: (t: Executor) => Promise<T>) => ('rollback' in db ? fn(db) : withTransaction(fn, db as Parameters<typeof withTransaction>[1]));

/**
 * Líneas de la factura: cada producto por su importe antes de descuentos (`subtotal`), una línea de descuento con el
 * total descontado, el envío (con el nombre del método) y los impuestos añadidos si los hay. Suman exactamente `total`.
 */
export const linesOf = (o: OrderDetail): InvoiceLine[] => [
  ...o.lines.map((l) => ({ description: `${l.name}${l.title ? ` · ${l.title}` : ''}`, quantity: l.quantity, unitPrice: l.unitPrice, total: l.subtotal })),
  ...(o.discountTotal ? [{ description: 'Discount', quantity: 1, unitPrice: -o.discountTotal, total: -o.discountTotal }] : []),
  ...(o.shippingTotal ? [{ description: `Shipping${o.shippingMethod?.label ? ` (${o.shippingMethod.label})` : ''}`, quantity: 1, unitPrice: o.shippingTotal, total: o.shippingTotal }] : []),
  ...(o.taxTotal ? [{ description: 'Tax', quantity: 1, unitPrice: o.taxTotal, total: o.taxTotal }] : []),
];

const recipientOf = (o: OrderDetail): Party | null => {
  const a = o.billingAddress ?? o.shippingAddress;
  return a ? { name: a.company || a.name, taxId: a.taxId ?? null, address: [a.line1, a.line2, a.postalCode, a.city, a.region].filter(Boolean).join(', '), country: a.country } : null;
};

/** Factura de un pedido pagado (idempotente): simplificada hasta el límite, completa por encima. */
export async function invoiceOrder(orderId: string, db: Executor = getDb()): Promise<Invoice> {
  return tx(db, async (t) => {
    const [existing] = await t.select().from(invoices).where(and(eq(invoices.orderId, orderId), sql`${invoices.type} in ('F1','F2')`));
    if (existing) return existing;
    const o = await getOrder(orderId, t);
    if (!o) throw new InvoiceError('not_found', `order ${orderId} not found`);
    if (o.status === 'pending' || o.status === 'cancelled') throw new InvoiceError('invalid_state', 'only paid orders are invoiced');
    const simplified = o.total <= simplifiedLimit();
    return issue(t, { type: simplified ? 'F2' : 'F1', orderId, recipient: simplified ? null : recipientOf(o), lines: linesOf(o), currency: o.currency, total: o.total });
  });
}

/** Rectificativa por diferencias (importe negativo) por un reembolso; `refundId` evita duplicados. */
export async function rectifyRefund(orderId: string, refundId: string, amount: number, db: Executor = getDb()): Promise<Invoice> {
  if (!Number.isInteger(amount) || amount <= 0) throw new InvoiceError('invalid', 'refund amount must be positive cents');
  return tx(db, async (t) => {
    const reason = `refund:${refundId}`;
    const [done] = await t.select().from(invoices).where(and(eq(invoices.orderId, orderId), eq(invoices.reason, reason)));
    if (done) return done;
    const [original] = await t.select().from(invoices).where(and(eq(invoices.orderId, orderId), sql`${invoices.type} in ('F1','F2','F3')`)).orderBy(desc(invoices.issuedAt)).limit(1);
    if (!original) throw new InvoiceError('invalid_state', 'the order has no invoice to rectify');
    return issue(t, {
      type: original.type === 'F2' ? 'R5' : 'R1',
      orderId,
      rectifiesId: original.id,
      reason,
      recipient: original.recipient,
      lines: [{ description: `Refund of invoice ${original.number}`, quantity: 1, unitPrice: -amount, total: -amount }],
      currency: original.currency,
      total: -amount,
    });
  });
}

/** Importe aún sin rectificar del pedido: su última factura (F1/F2/F3) más las rectificativas (negativas) ya emitidas. */
export async function remainingToRectify(orderId: string, db: Executor = getDb()): Promise<number> {
  const [original] = await db.select().from(invoices).where(and(eq(invoices.orderId, orderId), sql`${invoices.type} in ('F1','F2','F3')`)).orderBy(desc(invoices.issuedAt)).limit(1);
  if (!original) return 0;
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${invoices.total}), 0)`.mapWith(Number) }).from(invoices).where(and(eq(invoices.orderId, orderId), sql`${invoices.type} in ('R1','R5')`));
  return original.total + (r?.n ?? 0);
}

/** Rectifica lo que quede del pedido de la factura `invoiceId` (abono total); falla si ya no queda nada. */
export async function rectifyInFull(invoiceId: string, db: Executor = getDb()): Promise<Invoice> {
  return tx(db, async (t) => {
    const [inv] = await t.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!inv?.orderId) throw new InvoiceError('not_found');
    // Serializa los abonos del pedido para que dos simultáneos no rectifiquen dos veces lo mismo.
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoices:rectify:${inv.orderId}`}))`);
    const remaining = await remainingToRectify(inv.orderId, t);
    if (remaining <= 0) throw new InvoiceError('invalid_state', 'nothing left to rectify on this order');
    return rectifyRefund(inv.orderId, `manual-${inv.id}-${remaining}`, remaining, t);
  });
}

/** Factura completa (F3) que sustituye a una simplificada cuando el cliente aporta sus datos fiscales. */
export async function replaceSimplified(invoiceId: string, recipient: z.input<typeof Recipient>, db: Executor = getDb()): Promise<Invoice> {
  const r = Recipient.parse(recipient);
  return tx(db, async (t) => {
    const [s] = await t.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!s) throw new InvoiceError('not_found');
    if (s.type !== 'F2') throw new InvoiceError('invalid_state', 'only simplified invoices can be replaced');
    const [already] = await t.select().from(invoices).where(and(eq(invoices.rectifiesId, s.id), eq(invoices.type, 'F3')));
    if (already) throw new InvoiceError('invalid_state', `already replaced by ${already.number}`);
    return issue(t, { type: 'F3', orderId: s.orderId, rectifiesId: s.id, reason: 'replaces-simplified', recipient: r, lines: s.lines, currency: s.currency, total: s.total });
  });
}

/** Comprueba que la cadena de registros del emisor no se ha alterado (recalcula cada huella y su enlace). */
export async function verifyChain(issuerTaxId: string, db: Executor = getDb()): Promise<{ ok: boolean; records: number; brokenAt?: number }> {
  const rows = await db.select().from(invoiceRecords).where(eq(invoiceRecords.issuerTaxId, issuerTaxId)).orderBy(invoiceRecords.seq);
  let prev = '';
  for (const r of rows) {
    const f = r.fields as unknown as AltaFields;
    if ((f.Huella ?? '') !== prev || (await huella(f)) !== r.huella) return { ok: false, records: rows.length, brokenAt: r.seq };
    prev = r.huella;
  }
  return { ok: true, records: rows.length };
}

/** URL del QR de cotejo de la AEAT para imprimir en la factura (`INVOICE_QR_ENV=test` usa el entorno de pruebas). */
export const invoiceQrUrl = (inv: Invoice) =>
  qrUrl({ nif: inv.issuer.taxId!, number: inv.number, date: spanishDate(inv.issuedAt), total: amountText(inv.total) }, process.env.INVOICE_QR_ENV === 'test' ? 'test' : 'production');

/** Emite la factura al pagarse el pedido y la rectificativa en cada reembolso (vía @core/orders, con reintentos). */
export function registerInvoicing(): void {
  onOrderEvent('paid', 'invoices.issue', async (order) => {
    await invoiceOrder(order.id);
  });
  onOrderEvent('refunded', 'invoices.rectify', async (order, data) => {
    const refundId = String(data.refundId ?? '');
    const refund = order.refunds.find((r) => r.id === refundId);
    if (refund) await rectifyRefund(order.id, refund.id, refund.amount);
  });
}
registerInvoicing();
