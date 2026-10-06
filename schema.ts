// Tablas de @core/invoices. Las recoge drizzle-kit vía src/lib/db/drizzle.config.ts.
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from '../db/index.js';

export type Party = { name: string; taxId?: string | null; address?: string | null; country?: string | null };
export type InvoiceLine = { description: string; quantity: number; unitPrice: number; total: number };

/** Contador por serie y año: numeración correlativa sin huecos (se bloquea la fila al emitir). */
export const invoiceCounters = pgTable(
  'invoice_counters',
  { series: text('series').notNull(), year: integer('year').notNull(), last: integer('last').notNull().default(0) },
  (t) => [primaryKey({ columns: [t.series, t.year] })],
);

export const invoices = pgTable(
  'invoices',
  {
    id: primaryId('inv'),
    /** Serie + año + número: `A2026-000123`. */
    number: text('number').notNull().unique(),
    series: text('series').notNull(),
    /** F1 completa, F2 simplificada, F3 en sustitución de simplificada, R1 rectificativa, R5 rectificativa de simplificada. */
    type: text('type', { enum: ['F1', 'F2', 'F3', 'R1', 'R5'] }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull(),
    orderId: text('order_id'),
    /** Factura rectificada o sustituida. */
    rectifiesId: text('rectifies_id'),
    reason: text('reason'),
    issuer: jsonb('issuer').$type<Party>().notNull(),
    recipient: jsonb('recipient').$type<Party | null>(),
    lines: jsonb('lines').$type<InvoiceLine[]>().notNull(),
    currency: text('currency').notNull(),
    /** Importes en céntimos; en rectificativas por diferencias, negativos. */
    base: integer('base').notNull(),
    vatRate: integer('vat_rate').notNull(),
    vat: integer('vat').notNull(),
    total: integer('total').notNull(),
    ...timestamps,
  },
  (t) => [index('invoices_order_idx').on(t.orderId), uniqueIndex('invoices_order_type_idx').on(t.orderId, t.type, t.reason)],
);

/**
 * Registros de facturación encadenados (RD 1007/2023, Orden HAC/1177/2024): cada alta o anulación lleva la huella
 * SHA-256 del anterior del mismo emisor. Son inalterables: nunca se actualizan ni se borran.
 */
export const invoiceRecords = pgTable(
  'invoice_records',
  {
    id: primaryId('irc'),
    invoiceId: text('invoice_id').notNull(),
    issuerTaxId: text('issuer_tax_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind', { enum: ['alta', 'anulacion'] }).notNull(),
    huella: text('huella').notNull(),
    previousHuella: text('previous_huella'),
    /** `FechaHoraHusoGenRegistro` tal y como entra en la huella. */
    generatedAt: text('generated_at').notNull(),
    /** Campos del registro tal y como entran en la huella (para verificar la cadena). */
    fields: jsonb('fields').$type<Record<string, string>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoice_records_chain_idx').on(t.issuerTaxId, t.seq)],
);

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceRecord = typeof invoiceRecords.$inferSelect;
