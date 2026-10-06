// Huella (hash) encadenada y código QR de los registros de facturación según las especificaciones técnicas de la AEAT
// (Orden HAC/1177/2024). Comprueba siempre la versión vigente de los documentos técnicos antes de producción.

/** dd-mm-aaaa en hora de Madrid. */
export function spanishDate(d: Date): string {
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return `${v('day')}-${v('month')}-${v('year')}`;
}

/** `2024-01-01T19:20:30+01:00`: fecha, hora y huso horario de Madrid (sin milisegundos). */
export function madridTimestamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  const off = v('timeZoneName').replace('GMT', '') || '+00:00';
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}:${v('second')}${off}`;
}

/** Importe en céntimos → texto con punto decimal y dos decimales (`123.45`, `-5.00`). */
export const amountText = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

export type AltaFields = {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  FechaExpedicionFactura: string;
  TipoFactura: string;
  CuotaTotal: string;
  ImporteTotal: string;
  Huella: string;
  FechaHoraHusoGenRegistro: string;
};

export type AnulacionFields = {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  FechaExpedicionFacturaAnulada: string;
  Huella: string;
  FechaHoraHusoGenRegistro: string;
};

const ORDER_ALTA: Array<keyof AltaFields> = ['IDEmisorFactura', 'NumSerieFactura', 'FechaExpedicionFactura', 'TipoFactura', 'CuotaTotal', 'ImporteTotal', 'Huella', 'FechaHoraHusoGenRegistro'];
const ORDER_ANULACION: Array<keyof AnulacionFields> = ['IDEmisorFacturaAnulada', 'NumSerieFacturaAnulada', 'FechaExpedicionFacturaAnulada', 'Huella', 'FechaHoraHusoGenRegistro'];

/** Cadena `campo=valor&…` (valores sin espacios iniciales/finales) en el orden de la especificación. */
export function huellaInput(fields: AltaFields | AnulacionFields): string {
  const order = 'TipoFactura' in fields ? ORDER_ALTA : ORDER_ANULACION;
  return order.map((k) => `${k}=${String((fields as Record<string, string>)[k] ?? '').trim()}`).join('&');
}

/** SHA-256 en hexadecimal en mayúsculas. */
export async function huella(fields: AltaFields | AnulacionFields): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(huellaInput(fields)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** URL del código QR de cotejo de la AEAT (`test` usa el entorno de pruebas). */
export function qrUrl(p: { nif: string; number: string; date: string; total: string }, env: 'production' | 'test' = 'production'): string {
  const base = env === 'production' ? 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR' : 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR';
  const q = new URLSearchParams({ nif: p.nif, numserie: p.number, fecha: p.date, importe: p.total });
  return `${base}?${q}`;
}
