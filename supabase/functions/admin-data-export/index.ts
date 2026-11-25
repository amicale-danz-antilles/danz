import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { corsHeaders, isAllowedOrigin } from "../_shared/cors.mjs";

const TABLES = [
  "profiles",
  "membership_requests",
  "news",
  "events",
  "content_attachments",
  "event_albums",
  "gallery",
  "documents",
  "good_deals",
  "good_deal_submissions",
  "polls",
  "poll_options",
  "poll_votes",
  "bureau_members",
  "notification_preferences",
  "admin_audit_log",
];

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = corsHeaders(origin);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (!isAllowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authentification requise.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Session invalide.");

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile } = await admin.from("profiles").select("role,access_type,active").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin" || profile?.access_type !== "admin" || profile?.active !== true) throw new Error("Accès administrateur requis.");

    const body = await req.json().catch(() => ({}));
    if (body?.action !== "export") throw new Error("Action invalide.");

    const tables: Record<string, unknown[]> = {};
    for (const table of TABLES) {
      const { data, error } = await admin.from(table).select("*");
      if (error) throw new Error(`Export impossible pour ${table}: ${error.message}`);
      tables[table] = data || [];
    }

    const authUsers: Array<Record<string, unknown>> = [];
    let page = 1;
    while (page <= 20) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      for (const item of data.users || []) authUsers.push({
        id: item.id,
        email: item.email || null,
        created_at: item.created_at,
        updated_at: item.updated_at,
        last_sign_in_at: item.last_sign_in_at || null,
        email_confirmed_at: item.email_confirmed_at || null,
      });
      if ((data.users || []).length < 1000) break;
      page += 1;
    }

    await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      action: "data_exported",
      target_user_id: null,
      details: { format: "json", tables: TABLES, auth_users: authUsers.length },
    });

    return json({
      format: "danz-backup-v1",
      generated_at: new Date().toISOString(),
      generated_by: user.id,
      notice: "Sauvegarde des données structurées. Les mots de passe, secrets serveur et fichiers binaires ne sont jamais inclus.",
      auth_users: authUsers,
      tables,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue" }, 400);
  }
});
