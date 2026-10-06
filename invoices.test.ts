import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import * as authSchema from '../auth/schema.js';
import * as catalogSchema from '../catalog/schema.js';
import { testDb } from '../db/__fixtures__/pglite.js';
import type { Db } from '../db/index.js';
import { setEmailProvider } from '../email/index.js';
import { runDue } from '../jobs/index.js';
import * as jobsSchema from '../jobs/schema.js';
import { clearPaymentProviders, createOrder, registerPaymentProvider, refundOrder } from '../orders/index.js';
import * as ordersSchema from '../orders/schema.js';
import * as schema from './schema.js';
import {
  amountText,
  huella,
  invoiceHtml,
  invoiceOrder,
  invoiceQrUrl,
  invoiceRecords,
  invoices,
  invoicesAdminResource,
  madridTimestamp,
  rectifyRefund,
  replaceSimplified,
  spanishDate,
  split,
  verifyChain,
} from './index.js';

let db: Db;
const admin = { user: { id: 'u', email: null, name: null }, can: async () => true };

async function paidOrder(total: number, extra: Record<string, unknown> = {}) {
  return createOrder({
    email: 'ana@x.test',
    currency: 'EUR',
    lines: [{ variantId: null, productId: null, sku: null, name: 'Mug <b>', title: 'Red', kind: 'physical', quantity: 1, unitPrice: total, discount: 0 }],
    shippingAddress: { name: 'Ana Ruiz', line1: 'Calle Mayor 1', city: 'Valencia', postalCode: '46001', country: 'ES' },
    payment: { provider: 'test', ref: `pi_${Math.random()}`, status: 'paid' },
    reserveStock: false,
    ...extra,
  } as never);
}

beforeEach(async () => {
  db = await testDb(authSchema, catalogSchema, ordersSchema, jobsSchema, schema);
  Object.assign(process.env, { INVOICE_ISSUER_NIF: 'B12345678', INVOICE_ISSUER_NAME: 'Acme SL', INVOICE_ISSUER_ADDRESS: 'Calle Sol 2, 28001 Madrid', ORDER_LINK_SECRET: 'o'.repeat(40), SITE_URL: 'https://shop.test', EMAIL_FROM: 'shop@shop.test' });
  delete process.env.INVOICE_RETAIL;
  delete process.env.INVOICE_SERIES;
  setEmailProvider({ name: 't', send: async () => ({ id: null }) });
  clearPaymentProviders();
  registerPaymentProvider({ name: 'test', refund: async () => ({ ref: `re_${Math.random()}` }) } as never);
});

describe('VeriFactu record helpers', () => {
  it('matches the AEAT example hash for a first record (empty previous hash)', async () => {
    const h = await huella({
      IDEmisorFactura: '89890001K',
      NumSerieFactura: '12345678/G33',
      FechaExpedicionFactura: '01-01-2024',
      TipoFactura: 'F1',
      CuotaTotal: '12.35',
      ImporteTotal: '123.45',
      Huella: '',
      FechaHoraHusoGenRegistro: '2024-01-01T19:20:30+01:00',
    });
    expect(h).toBe('3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60');
  });

  it('formats dates in Madrid time and amounts with two decimals', () => {
    expect(spanishDate(new Date('2026-12-31T23:30:00Z'))).toBe('01-01-2027'); // ya es 1 de enero en Madrid
    expect(madridTimestamp(new Date('2026-07-01T10:00:00Z'))).toBe('2026-07-01T12:00:00+02:00');
    expect(madridTimestamp(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15T11:00:00+01:00');
    expect([amountText(12345), amountText(5), amountText(-500)]).toEqual(['123.45', '0.05', '-5.00']);
    expect(split(12100)).toEqual({ base: 10000, vat: 2100 });
    expect(split(1999)).toEqual({ base: 1652, vat: 347 });
  });
});

describe('issuing invoices', () => {
  it('issues one simplified invoice per paid order with correlative numbers and a chained record', async () => {
    const a = await paidOrder(1999);
    const b = await paidOrder(2500);
    const ia = await invoiceOrder(a.id);
    expect(await invoiceOrder(a.id)).toEqual(ia); // idempotente
    const ib = await invoiceOrder(b.id);
    const year = spanishDate(new Date()).slice(6);
    expect([ia.number, ib.number]).toEqual([`A${year}-000001`, `A${year}-000002`]);
    expect(ia).toMatchObject({ type: 'F2', recipient: null, total: 1999, base: 1652, vat: 347, vatRate: 21 });
    const recs = await db.select().from(invoiceRecords).orderBy(invoiceRecords.seq);
    expect(recs.map((r) => r.seq)).toEqual([1, 2]);
    expect(recs[0]!.previousHuella).toBeNull();
    expect(recs[1]!.previousHuella).toBe(recs[0]!.huella);
    expect(await verifyChain('B12345678')).toEqual({ ok: true, records: 2 });
  });

  it('issues a full invoice above the simplified limit (400 €) and rectifies refunds by differences', async () => {
    const o = await paidOrder(50_000);
    const inv = await invoiceOrder(o.id);
    expect(inv).toMatchObject({ type: 'F1', recipient: { name: 'Ana Ruiz', address: 'Calle Mayor 1, 46001, Valencia', country: 'ES' } });
    const r = await rectifyRefund(o.id, 're_1', 10_000);
    expect(r).toMatchObject({ type: 'R1', total: -10_000, rectifiesId: inv.id });
    expect(r.number).toMatch(/^AR\d{4}-000001$/); // serie propia de rectificativas
    expect(await rectifyRefund(o.id, 're_1', 10_000)).toEqual(r);
    await expect(rectifyRefund(o.id, 're_2', 0)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('replaces a simplified invoice by a full one with the customer tax details (once)', async () => {
    const inv = await invoiceOrder((await paidOrder(1999)).id);
    const full = await replaceSimplified(inv.id, { name: 'Ana Ruiz', taxId: '12345678z', address: 'Calle Mayor 1, Valencia' });
    expect(full).toMatchObject({ type: 'F3', rectifiesId: inv.id, recipient: { taxId: '12345678Z' }, total: 1999 });
    await expect(replaceSimplified(inv.id, { name: 'x', taxId: '12345678Z', address: 'xxxxx' })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(replaceSimplified(full.id, { name: 'x', taxId: '12345678Z', address: 'xxxxx' })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('detects any tampering with the chain', async () => {
    await invoiceOrder((await paidOrder(1000)).id);
    await invoiceOrder((await paidOrder(2000)).id);
    const [first] = await db.select().from(invoiceRecords).where(eq(invoiceRecords.seq, 1));
    await db.update(invoiceRecords).set({ fields: { ...first!.fields, ImporteTotal: '1.00' } }).where(eq(invoiceRecords.id, first!.id));
    expect(await verifyChain('B12345678')).toEqual({ ok: false, records: 2, brokenAt: 1 });
  });

  it('refuses invoices without issuer configuration or in other currencies', async () => {
    delete process.env.INVOICE_ISSUER_NIF;
    await expect(invoiceOrder((await paidOrder(1000)).id)).rejects.toMatchObject({ code: 'config' });
    process.env.INVOICE_ISSUER_NIF = 'B12345678';
    await expect(invoiceOrder((await paidOrder(1000, { currency: 'USD' })).id)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('order events, printing and admin', () => {
  it('invoices on payment and rectifies on refund through @core/orders events', async () => {
    const o = await paidOrder(3000);
    await runDue();
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, o.id));
    expect(inv).toMatchObject({ type: 'F2', total: 3000 });
    await refundOrder(o.id, { amount: 1000, reason: 'damaged' } as never);
    await runDue();
    const all = await db.select().from(invoices).where(eq(invoices.orderId, o.id));
    expect(all.map((i) => [i.type, i.total]).sort()).toEqual([['F2', 3000], ['R5', -1000]]);
  });

  it('prints an escaped HTML invoice with the AEAT QR link', async () => {
    const inv = await invoiceOrder((await paidOrder(1999)).id);
    const html = invoiceHtml(inv);
    expect(html).toContain('Factura simplificada');
    expect(html).toContain('Mug &lt;b&gt; · Red');
    expect(html).toContain('16,52 €');
    expect(invoiceQrUrl(inv)).toBe(`https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=${encodeURIComponent(inv.number)}&fecha=${spanishDate(inv.issuedAt)}&importe=19.99`);
  });

  it('admin: read-only list, full-invoice replacement and full credit note', async () => {
    const inv = await invoiceOrder((await paidOrder(1999)).id);
    const res = invoicesAdminResource({ printPath: (i) => `/invoices/${i.number}` });
    expect((await res.list({ page: 1, pageSize: 10 }, admin)).total).toBe(1);
    expect(res.create).toBeUndefined();
    expect(res.delete).toBeUndefined();
    expect(await res.links!(inv, admin)).toEqual([{ label: 'Print / PDF', href: `/invoices/${inv.number}` }]);
    const credit = await res.actions!.find((a) => a.name === 'rectify-total')!.run(inv.id, {}, admin);
    expect(credit).toMatchObject({ type: 'R5', total: -1999 });
    await expect(res.list({ page: 1, pageSize: 10 }, { ...admin, can: async () => false })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
