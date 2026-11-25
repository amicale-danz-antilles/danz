import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { corsHeaders, isAllowedOrigin } from "../_shared/cors.mjs";

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Session invalide.");

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: adminProfile } = await admin.from("profiles").select("role,active").eq("id", user.id).single();
    if (adminProfile?.role !== "admin" || adminProfile?.active !== true) throw new Error("Accès administrateur requis.");

    const body = await req.json();
    const requestId = body?.requestId;
    const action = body?.action === "reject" ? "reject" : "approve";
    if (!requestId) throw new Error("Demande manquante.");

    const { data: request, error: requestError } = await admin
      .from("membership_requests")
      .select("id,auth_user_id,full_name,first_name,last_name,email,status,applicant_type,is_amicaliste")
      .eq("id", requestId)
      .single();
    if (requestError || !request) throw new Error("Demande introuvable.");
    if (request.status !== "pending") throw new Error("Cette demande a déjà été traitée.");

    let authUserId = request.auth_user_id as string | null;
    if (!authUserId) {
      const { data: existingProfile } = await admin.from("profiles").select("id").ilike("email", request.email).maybeSingle();
      authUserId = existingProfile?.id || null;
    }

    if (action === "reject") {
      const { error: updateError } = await admin.from("membership_requests").update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      }).eq("id", request.id);
      if (updateError) throw updateError;

      if (authUserId) {
        const { data: targetProfile } = await admin.from("profiles").select("active").eq("id", authUserId).maybeSingle();
        if (targetProfile?.active !== true) await admin.auth.admin.deleteUser(authUserId, false);
      }

      await admin.from("admin_audit_log").insert({
        actor_id: user.id,
        action: "membership_rejected",
        target_user_id: null,
        details: { request_id: request.id, email: request.email },
      });
      return json({ ok: true, action: "rejected" });
    }

    if (!authUserId) throw new Error("Le compte associé à cette demande n’existe pas. La personne doit créer une nouvelle demande avec son mot de passe.");

    const fullName = [request.first_name, request.last_name].filter(Boolean).join(" ") || request.full_name;
    const applicantType = request.applicant_type === "spouse" ? "spouse" : "military";
    const accessType = applicantType === "military" ? "personnel_danz" : "member";
    const isAmicaliste = request.is_amicaliste === true;

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(authUserId, { email_confirm: true });
    if (authUpdateError) throw authUpdateError;

    const { error: profileError } = await admin.from("profiles").upsert({
      id: authUserId,
      full_name: fullName,
      email: request.email,
      role: "member",
      access_type: accessType,
      applicant_type: applicantType,
      is_amicaliste: isAmicaliste,
      active: true,
      deactivated_at: null,
      deactivated_by: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    const { error: updateError } = await admin.from("membership_requests").update({
      auth_user_id: authUserId,
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    }).eq("id", request.id);
    if (updateError) throw updateError;

    await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      action: "membership_approved",
      target_user_id: authUserId,
      details: { request_id: request.id, email: request.email, is_amicaliste: isAmicaliste },
    });

    return json({ ok: true, action: "approved" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue" }, 400);
  }
});
