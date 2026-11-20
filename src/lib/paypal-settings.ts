import { supabase } from "@/integrations/supabase/client";

export type PaypalBusinessSettings = {
  businessName: string;
  email: string;
  businessEmail: string;
  clientId: string;
  secret: string;
  mode: "sandbox" | "live";
};

type AnyRow = Record<string, unknown>;

type AnyQueryClient = {
  from: (table: string) => {
    select: (columns: string) => AnyFilter;
    upsert: (values: AnyRow) => AnyFilter;
    update: (values: AnyRow) => AnyFilter;
    insert: (values: AnyRow) => AnyFilter;
  };
};

type AnyFilter = {
  eq: (column: string, value: string | number) => AnyFilter;
  maybeSingle: () => Promise<{ data: AnyRow | null; error: { message: string } | null }>;
  select: (columns?: string) => AnyFilter;
  then: Promise<{ data: AnyRow[] | null; error: { message: string } | null }>["then"];
};

const PAYMENT_COLUMNS = [
  "id",
  "business_name",
  "paypal_business_name",
  "paypal_email",
  "admin_paypal_email",
  "paypal_client_id",
  "paypal_secret",
  "paypal_mode",
].join(",");

const APP_COLUMNS = [
  "id",
  "business_name",
  "paypal_email",
  "admin_paypal_email",
  "paypal_client_id",
  "paypal_secret",
  "paypal_mode",
  "config",
].join(",");

function text(row: AnyRow | null, keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function configText(row: AnyRow | null, keys: string[]): string {
  const config = row?.config;
  if (!config || typeof config !== "object") return "";
  return text(config as AnyRow, keys);
}

function modeOf(value: string): "sandbox" | "live" {
  return value === "sandbox" ? "sandbox" : "live";
}

export async function loadPaypalBusinessSettings(): Promise<PaypalBusinessSettings> {
  const db = supabase as unknown as AnyQueryClient;
  let payment: AnyRow | null = null;
  let app: AnyRow | null = null;

  const paymentResult = await db.from("payment_settings").select(PAYMENT_COLUMNS).eq("id", 1).maybeSingle();
  if (!paymentResult.error) payment = paymentResult.data;
  else {
    const fallback = await db
      .from("payment_settings")
      .select("id,paypal_business_name,paypal_email,paypal_client_id,paypal_secret,paypal_mode")
      .eq("id", 1)
      .maybeSingle();
    payment = fallback.error ? null : fallback.data;
  }

  const appResult = await db.from("app_settings").select(APP_COLUMNS).eq("id", 1).maybeSingle();
  if (!appResult.error) app = appResult.data;
  else {
    const fallback = await db.from("app_settings").select("id,paypal_email,config").eq("id", 1).maybeSingle();
    app = fallback.error ? null : fallback.data;
  }

  const email =
    text(payment, ["paypal_email", "admin_paypal_email"]) ||
    text(app, ["paypal_email", "admin_paypal_email"]) ||
    configText(app, ["paypal_email", "admin_paypal_email", "paypalEmail"]);
  const businessEmail =
    text(payment, ["admin_paypal_email", "paypal_email"]) ||
    text(app, ["admin_paypal_email", "paypal_email"]) ||
    email;
  const clientId =
    text(payment, ["paypal_client_id"]) ||
    text(app, ["paypal_client_id"]) ||
    configText(app, ["paypal_client_id", "paypalClientId", "clientId"]);
  const secret =
    text(payment, ["paypal_secret"]) ||
    text(app, ["paypal_secret"]) ||
    configText(app, ["paypal_secret", "paypalSecret"]);
  const mode = modeOf(
    text(payment, ["paypal_mode"]) || text(app, ["paypal_mode"]) || configText(app, ["paypal_mode", "mode"]),
  );

  return {
    businessName:
      text(payment, ["business_name", "paypal_business_name"]) ||
      text(app, ["business_name"]) ||
      configText(app, ["business_name", "paypal_business_name", "businessName"]),
    email,
    businessEmail,
    clientId,
    secret,
    mode,
  };
}

export async function savePaypalBusinessSettings(input: PaypalBusinessSettings): Promise<void> {
  const db = supabase as unknown as AnyQueryClient;
  const businessName = input.businessName.trim().slice(0, 120);
  const email = input.email.trim().slice(0, 180);
  const businessEmail = (input.businessEmail.trim() || email).slice(0, 180);
  const clientId = input.clientId.trim().slice(0, 240);
  const secret = input.secret.trim().slice(0, 240);
  const mode = modeOf(input.mode);

  const paymentBase = {
    id: 1,
    paypal_business_name: businessName,
    paypal_email: email,
    paypal_client_id: clientId,
    paypal_secret: secret,
    paypal_mode: mode,
  };
  const paymentFull = {
    ...paymentBase,
    business_name: businessName,
    admin_paypal_email: businessEmail,
  };
  let paymentSaved = false;
  for (const payload of [paymentFull, paymentBase]) {
    const { error } = await db.from("payment_settings").upsert(payload);
    if (!error) {
      paymentSaved = true;
      break;
    }
  }
  if (!paymentSaved) throw new Error("No se pudo guardar PayPal Business en payment_settings.");

  const config = {
    business_name: businessName,
    paypal_business_name: businessName,
    paypal_email: email,
    admin_paypal_email: businessEmail,
    paypal_client_id: clientId,
    paypal_secret: secret,
    paypal_mode: mode,
  };
  const appBase = { id: 1, paypal_email: email, config };
  const appFull = {
    ...appBase,
    business_name: businessName,
    admin_paypal_email: businessEmail,
    paypal_client_id: clientId,
    paypal_secret: secret,
    paypal_mode: mode,
  };
  let appSaved = false;
  for (const payload of [appFull, appBase]) {
    const { data, error } = await db.from("app_settings").update(payload).eq("id", 1).select("id");
    if (!error) {
      if (data?.length) {
        appSaved = true;
        break;
      }
      const upsert = await db.from("app_settings").upsert(payload);
      if (!upsert.error) {
        appSaved = true;
        break;
      }
    }
  }
  if (!appSaved) throw new Error("No se pudo guardar PayPal Business en app_settings.");
}
