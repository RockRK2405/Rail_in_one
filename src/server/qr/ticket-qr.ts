import QRCode from 'qrcode';
import { env } from '@/env';

/**
 * QR ticket generation. The QR encodes ONLY an opaque verification URL built
 * from the booking's random `ticketToken` — never the customer's name, email,
 * seat list, or price. A gate scanner resolves the token server-side.
 */

export function ticketUrl(ticketToken: string): string {
  return `${env().APP_URL}/t/${ticketToken}`;
}

/** Returns a PNG data URI suitable for <img src> and inline email. */
export function ticketQrDataUrl(ticketToken: string): Promise<string> {
  return QRCode.toDataURL(ticketUrl(ticketToken), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
  });
}
