// @core/invoices — API pública. Al importarlo emite facturas al pagarse los pedidos y rectificativas en los reembolsos.
export { invoicesAdminResource } from './admin.js';
export { INVOICE_TITLES, invoiceHtml } from './html.js';
export {
  InvoiceError,
  invoiceOrder,
  invoiceQrUrl,
  issuer,
  rectifyRefund,
  registerInvoicing,
  replaceSimplified,
  simplifiedLimit,
  split,
  verifyChain,
} from './invoices.js';
export { type Invoice, type InvoiceLine, type InvoiceRecord, invoiceCounters, invoiceRecords, invoices, type Party } from './schema.js';
export { type AltaFields, type AnulacionFields, amountText, huella, huellaInput, madridTimestamp, qrUrl, spanishDate } from './verifactu.js';
