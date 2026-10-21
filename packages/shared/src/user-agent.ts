import type { DeviceOs } from './schemas.js';

export function detectOs(userAgent: string | null | undefined): DeviceOs {
  if (!userAgent) return 'other';
  // iPadOS 13+ se presenta como Macintosh; no es distinguible sin JS, queda como "other".
  if (/\b(iPhone|iPad|iPod)\b/i.test(userAgent)) return 'ios';
  if (/\bAndroid\b/i.test(userAgent)) return 'android';
  return 'other';
}

/**
 * Crawlers de previsualización de enlaces y bots genéricos.
 * Se registran con is_bot = 1 y se excluyen de las estadísticas.
 */
const BOT_PATTERNS: readonly RegExp[] = [
  /WhatsApp/i,
  /facebookexternalhit|Facebot|meta-externalagent/i,
  /TelegramBot/i,
  /Slackbot|Slack-ImgProxy/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Discordbot/i,
  /SkypeUriPreview/i,
  /Pinterest/i,
  /redditbot/i,
  /Googlebot|AdsBot-Google|Google-InspectionTool|GoogleOther/i,
  /bingbot|BingPreview/i,
  /Applebot/i,
  /DuckDuckBot/i,
  /YandexBot/i,
  /Baiduspider/i,
  /Embedly|vkShare|Iframely/i,
  /\b(bot|crawler|spider|preview)\b/i,
  /^(curl|wget|python-requests|python-urllib|Go-http-client|okhttp|axios|node-fetch|undici)\b/i,
];

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}
