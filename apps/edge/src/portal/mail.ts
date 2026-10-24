import type { Env } from '../env.js';

// Envío de correos detrás de una interfaz: cambiar de proveedor es cambiar este archivo.
// Hoy: Resend (plan gratis: 3.000 al mes, 100 al día).

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

const DEFAULT_FROM = 'PengineXR <acceso@penginexr.com>';
const RESEND_URL = 'https://api.resend.com/emails';

function resendSender(apiKey: string, from: string): MailSender {
  return {
    async send(message) {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(`Resend respondió ${response.status}: ${detail}`);
      }
    },
  };
}

/**
 * Sin RESEND_API_KEY no se envía nada. En desarrollo (MAIL_DEV_LOG=true) el correo se escribe
 * en la consola; en producción nunca, porque el enlace daría acceso a quien lea los logs.
 */
export function mailSender(env: Env): MailSender {
  if (env.RESEND_API_KEY) return resendSender(env.RESEND_API_KEY, env.MAIL_FROM ?? DEFAULT_FROM);
  return {
    async send(message) {
      if (env.MAIL_DEV_LOG === 'true') {
        console.log(`[correo de desarrollo] Para: ${message.to}\n${message.text}`);
        return;
      }
      console.warn('Falta RESEND_API_KEY: no se envió el correo', { subject: message.subject });
    },
  };
}
