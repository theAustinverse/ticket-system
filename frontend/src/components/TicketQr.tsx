import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ticketUrl } from '../tickets';

/**
 * Dark-on-cream from the theme palette (--void on --paper): high enough
 * contrast for any phone camera, without dropping a stark white square into
 * the page. Medium error correction survives a cracked screen or glare.
 */
export function TicketQr({ token, size = 220 }: { token: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(ticketUrl(token), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size * 2, // crisp on high-DPI screens
      color: { dark: '#0b0806', light: '#ece2c6' },
    }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [token, size]);

  return (
    <div className="ticket-qr" style={{ width: size, height: size }}>
      {src && <img src={src} alt="入場 QR Code" width={size} height={size} />}
    </div>
  );
}
