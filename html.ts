// Factura en HTML imprimible (también para PDF con el navegador) con el contenido obligatorio del RD 1619/2012.
// Todos los textos se escapan; el QR se pinta con la URL de cotejo (genera la imagen con una librería de QR en la app).
import { type Invoice } from './schema.js';
import { invoiceQrUrl } from './invoices.js';
import { amountText, spanishDate } from './verifactu.js';

const esc = (s: unknown) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const eur = (c: number) => `${amountText(c).replace('.', ',')} €`;

export const INVOICE_TITLES: Record<Invoice['type'], string> = {
  F1: 'Factura',
  F2: 'Factura simplificada',
  F3: 'Factura (en sustitución de factura simplificada)',
  R1: 'Factura rectificativa',
  R5: 'Factura rectificativa (de factura simplificada)',
};

export function invoiceHtml(inv: Invoice, opts: { rectifiedNumber?: string; qrImageSrc?: string } = {}): string {
  const r = inv.recipient;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(INVOICE_TITLES[inv.type])} ${esc(inv.number)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:48rem;margin:2rem auto;color:#111}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #ddd}td.n,th.n{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}</style></head><body>
<h1>${esc(INVOICE_TITLES[inv.type])} ${esc(inv.number)}</h1>
<p>Fecha de expedición: ${esc(spanishDate(inv.issuedAt))}${opts.rectifiedNumber ? ` · Rectifica/sustituye a: ${esc(opts.rectifiedNumber)}` : ''}</p>
<div class="grid"><section><h2>Emisor</h2><p>${esc(inv.issuer.name)}<br>NIF: ${esc(inv.issuer.taxId)}${inv.issuer.address ? `<br>${esc(inv.issuer.address)}` : ''}</p></section>
${r ? `<section><h2>Destinatario</h2><p>${esc(r.name)}${r.taxId ? `<br>NIF: ${esc(r.taxId)}` : ''}${r.address ? `<br>${esc(r.address)}` : ''}</p></section>` : ''}</div>
<table><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio (IVA incl.)</th><th class="n">Importe</th></tr></thead><tbody>
${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${l.quantity}</td><td class="n">${eur(l.unitPrice)}</td><td class="n">${eur(l.total)}</td></tr>`).join('')}
</tbody></table>
<table><tbody><tr><th>Base imponible</th><td class="n">${eur(inv.base)}</td></tr><tr><th>IVA ${inv.vatRate} %</th><td class="n">${eur(inv.vat)}</td></tr><tr><th>Total</th><td class="n"><strong>${eur(inv.total)}</strong></td></tr></tbody></table>
<p>${opts.qrImageSrc ? `<img src="${esc(opts.qrImageSrc)}" alt="Código QR de cotejo de la factura en la AEAT" width="120" height="120"><br>` : ''}Cotejo: <a href="${esc(invoiceQrUrl(inv))}">${esc(invoiceQrUrl(inv))}</a></p>
</body></html>`;
}
