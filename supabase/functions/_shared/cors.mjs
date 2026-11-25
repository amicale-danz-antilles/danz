const allowedOrigins = new Set([
  "https://amicale-danz-antilles.github.io",
  "https://danz-antilles.pages.dev",
]);

// Requests without Origin are permitted for existing server-to-server callers.
export const isAllowedOrigin = (origin) => origin === null || allowedOrigins.has(origin);

export const corsHeaders = (origin) => ({
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
