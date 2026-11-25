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
    const { data: adminProfile, error: adminProfileError } = await admin.from("profiles").select("id,role,active").eq("id", user.id).single();
    if (adminProfileError || adminProfile?.role !== "admin" || adminProfile?.active !== true) throw new Error("Accès administrateur requis.");

    const body = await req.json();
    const action = body?.action;
    const userId = body?.userId;
    if (!userId) throw new Error("Utilisateur manquant.");

    const { data: target, error: targetError } = await admin.from("profiles").select("id,email,role,active,access_type,applicant_type,is_amicaliste").eq("id", userId).single();
    if (targetError || !target) throw new Error("Utilisateur introuvable.");

    if (action === "set-password") {
      const password = typeof body?.password === "string" ? body.password : "";
      if (password.length < 10 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new Error("Le nouveau mot de passe doit contenir entre 10 et 128 caractères, avec au moins une lettre et un chiffre.");
      }
      const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
      if (passwordError) throw passwordError;

      const { error: auditError } = await admin.from("admin_audit_log").insert({
        actor_id: user.id,
        action: "user_password_reset_by_admin",
        target_user_id: userId,
        details: { reset_by_admin: true },
      });
      if (auditError) throw auditError;
      return json({ ok: true });
    }

    if (action === "set-access") {
      const active = body?.active === true;
      const requestedRole = body?.role === "admin" || body?.accessType === "admin" ? "admin" : "member";
      const applicantType = body?.applicantType === "spouse" ? "spouse" : body?.applicantType === "military" ? "military" : null;
      const isAmicaliste = typeof body?.isAmicaliste === "boolean" ? body.isAmicaliste : target.is_amicaliste === true;
      const accessType = requestedRole === "admin" ? "admin" : applicantType === "military" ? "personnel_danz" : "member";

      if (userId === user.id && (!active || requestedRole !== "admin")) throw new Error("Vous ne pouvez pas désactiver ni rétrograder votre propre compte administrateur.");

      if (target.active === true && target.role === "admin" && (!active || requestedRole !== "admin")) {
        const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
        if (countError) throw countError;
        if ((count || 0) <= 1) throw new Error("Le dernier administrateur actif ne peut pas être désactivé ou rétrogradé.");
      }

      const now = new Date().toISOString();
      const { error: updateError } = await admin.from("profiles").update({
        active,
        role: requestedRole,
        access_type: accessType,
        applicant_type: applicantType,
        is_amicaliste: isAmicaliste,
        updated_at: now,
        deactivated_at: active ? null : now,
        deactivated_by: active ? null : user.id,
      }).eq("id", userId);
      if (updateError) throw updateError;

      const { error: auditError } = await admin.from("admin_audit_log").insert({
        actor_id: user.id,
        action: active ? "user_access_updated" : "user_suspended",
        target_user_id: userId,
        details: {
          before: { active: target.active, role: target.role, access_type: target.access_type, applicant_type: target.applicant_type, is_amicaliste: target.is_amicaliste },
          after: { active, role: requestedRole, access_type: accessType, applicant_type: applicantType, is_amicaliste: isAmicaliste },
        },
      });
      if (auditError) throw auditError;
      return json({ ok: true });
    }

    if (action === "delete") {
      if (userId === user.id) throw new Error("Vous ne pouvez pas supprimer votre propre compte administrateur.");
      if (target.role === "admin" && target.active === true) {
        const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
        if (countError) throw countError;
        if ((count || 0) <= 1) throw new Error("Le dernier administrateur actif ne peut pas être supprimé.");
      }

      const nullableRefs = [
        ["bureau_members", "updated_by"],
        ["content_attachments", "created_by"],
        ["documents", "created_by"],
        ["events", "created_by"],
        ["gallery", "created_by"],
        ["good_deal_submissions", "reviewed_by"],
        ["good_deals", "created_by"],
        ["membership_requests", "reviewed_by"],
        ["news", "created_by"],
        ["polls", "created_by"],
      ];
      for (const [table, column] of nullableRefs) {
        const { error } = await admin.from(table).update({ [column]: null }).eq(column, userId);
        if (error) throw error;
      }

      if (target.email) {
        const { error } = await admin.from("membership_requests").delete().ilike("email", target.email);
        if (error) throw error;
      }

      const { error: auditError } = await admin.from("admin_audit_log").insert({ actor_id: user.id, action: "user_deleted", target_user_id: userId, details: { reason: "suppression_administrateur_rgpd" } });
      if (auditError) throw auditError;
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
      if (deleteError) throw deleteError;
      return json({ ok: true });
    }

    throw new Error("Action invalide.");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erreur inconnue" }, 400);
  }
});
