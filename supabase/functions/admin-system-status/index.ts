import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { corsHeaders, isAllowedOrigin } from "../_shared/cors.mjs";
const sumSizes = (rows: Array<{file_size?: number | null}>) => rows.reduce((sum, row) => sum + Number(row.file_size || 0), 0);

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

    const count = async (table: string, filters: Array<[string, unknown]> = []) => {
      let query: any = admin.from(table).select("id", { count: "exact", head: true });
      for (const [column, value] of filters) query = query.eq(column, value);
      const { count: value, error } = await query;
      if (error) throw error;
      return value || 0;
    };

    const [
      profilesTotal, profilesActive, profilesSuspended, pendingRequests,
      newsCount, eventsCount, dealsCount, pollsCount, albumsCount,
      galleryCount, attachmentsCount,
      galleryMedia, attachmentsMedia, albumsMedia,
      lastBackupResult, lastAdminActionResult,
    ] = await Promise.all([
      count("profiles"),
      count("profiles", [["active", true]]),
      count("profiles", [["active", false]]),
      count("membership_requests", [["status", "pending"]]),
      count("news"), count("events"), count("good_deals"), count("polls"), count("event_albums"),
      count("gallery"), count("content_attachments"),
      admin.from("gallery").select("file_size,storage_provider"),
      admin.from("content_attachments").select("file_size,storage_provider"),
      admin.from("event_albums").select("file_size,storage_provider"),
      admin.from("admin_audit_log").select("created_at,actor_id,details").eq("action", "data_exported").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("admin_audit_log").select("action,created_at,actor_id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    for (const result of [galleryMedia, attachmentsMedia, albumsMedia, lastBackupResult, lastAdminActionResult]) {
      if (result.error) throw result.error;
    }

    const mediaRows = [
      ...(galleryMedia.data || []),
      ...(attachmentsMedia.data || []),
      ...(albumsMedia.data || []),
    ] as Array<{file_size?: number | null; storage_provider?: string | null}>;
    const providerCounts: Record<string, number> = {};
    for (const row of mediaRows) {
      const provider = row.storage_provider || "legacy";
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    }

    const r2Configured = Boolean(
      Deno.env.get("R2_ACCOUNT_ID") &&
      Deno.env.get("R2_ACCESS_KEY_ID") &&
      Deno.env.get("R2_SECRET_ACCESS_KEY") &&
      Deno.env.get("R2_BUCKET")
    );

    return json({
      checked_at: new Date().toISOString(),
      services: {
        database: { ok: true, label: "Base de données" },
        authentication: { ok: true, label: "Authentification" },
        r2: { ok: r2Configured, label: "Stockage médias R2" },
        edge_functions: { ok: true, label: "Fonctions serveur" },
      },
      users: {
        total: profilesTotal,
        active: profilesActive,
        suspended: profilesSuspended,
        pending_requests: pendingRequests,
      },
      content: {
        news: newsCount,
        events: eventsCount,
        good_deals: dealsCount,
        polls: pollsCount,
        albums: albumsCount,
        legacy_gallery_items: galleryCount,
        attachments: attachmentsCount,
      },
      storage: {
        indexed_bytes: sumSizes(mediaRows),
        indexed_files: mediaRows.length,
        providers: providerCounts,
      },
      backup: lastBackupResult.data || null,
      last_admin_action: lastAdminActionResult.data || null,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue" }, 400);
  }
});
