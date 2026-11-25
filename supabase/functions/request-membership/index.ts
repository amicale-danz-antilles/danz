import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { corsHeaders, isAllowedOrigin } from "../_shared/cors.mjs";

const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const passwordOk = (value: string) => value.length >= 10 && /[A-Za-z]/.test(value) && /\d/.test(value);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return json({ error: "Origine non autorisée." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405, origin);

  let createdUserId: string | null = null;
  try {
    const body = await req.json();
    const firstName = clean(body?.firstName, 80);
    const lastName = clean(body?.lastName, 80);
    const email = clean(body?.email, 254).toLowerCase();
    const password = String(body?.password ?? "");
    const applicantType = body?.applicantType === "spouse" ? "spouse" : "military";
    const fullName = `${firstName} ${lastName}`.trim();

    if (firstName.length < 2 || lastName.length < 2) throw new Error("Nom et prénom requis.");
    if (!emailOk(email)) throw new Error("Adresse e-mail invalide.");
    if (!passwordOk(password)) throw new Error("Le mot de passe doit contenir au moins 10 caractères, avec au moins une lettre et un chiffre.");

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: requests, error: requestLookupError } = await admin
      .from("membership_requests")
      .select("id,status")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(10);
    if (requestLookupError) throw requestLookupError;
    if ((requests || []).some((item) => item.status === "pending")) throw new Error("Une demande est déjà en attente pour cette adresse e-mail.");
    if ((requests || []).some((item) => item.status === "approved")) throw new Error("Ce compte est déjà approuvé. Utilisez simplement la connexion e-mail + mot de passe.");

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      const message = String(createError?.message || "");
      if (/already|registered|exists/i.test(message)) throw new Error("Cette adresse possède déjà un compte. Utilisez la connexion ou contactez un administrateur.");
      throw createError || new Error("Création du compte impossible.");
    }
    createdUserId = created.user.id;

    const accessType = applicantType === "military" ? "personnel_danz" : "member";
    const { error: profileError } = await admin.from("profiles").upsert({
      id: created.user.id,
      full_name: fullName,
      email,
      role: "member",
      active: false,
      access_type: accessType,
      applicant_type: applicantType,
      is_amicaliste: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    const { error: insertError } = await admin.from("membership_requests").insert({
      auth_user_id: created.user.id,
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      email,
      applicant_type: applicantType,
      is_amicaliste: false,
      requested_access: "member",
      status: "pending",
    });
    if (insertError) throw insertError;

    return json({ ok: true }, 200, origin);
  } catch (error) {
    if (createdUserId) {
      try {
        const url = Deno.env.get("SUPABASE_URL")!;
        const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
        await admin.auth.admin.deleteUser(createdUserId, false);
      } catch {}
    }
    return json({ error: error instanceof Error ? error.message : "Demande impossible." }, 400, origin);
  }
});
