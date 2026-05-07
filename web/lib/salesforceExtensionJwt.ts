import { SignJWT, jwtVerify } from "jose";

const SECRET_ENV = "SALESFORCE_UI_EXTENSION_SECRET";

function getSecret(): Uint8Array {
  const s = process.env[SECRET_ENV];
  if (!s || s.length < 16) {
    throw new Error(`${SECRET_ENV} is not configured`);
  }
  return new TextEncoder().encode(s);
}

export type SalesforceExtensionTokenPayload = {
  org_id: number;
  rep_id: number;
  opportunity_id: number;
  public_id: string;
  crm_opp_id: string;
  purpose: "review" | "dashboard";
};

export async function signSalesforceExtensionToken(
  payload: SalesforceExtensionTokenPayload,
  ttlSeconds = 3600
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getSecret());
}

export async function verifySalesforceExtensionToken(
  token: string
): Promise<SalesforceExtensionTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as SalesforceExtensionTokenPayload;
}
