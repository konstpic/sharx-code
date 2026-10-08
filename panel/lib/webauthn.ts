// WebAuthn glue: the panel's server speaks the JSON shape of the WebAuthn spec (base64url for binary fields); the browser API
// wants ArrayBuffers. These helpers convert both ways, so a passkey or a security key can be registered and used.

type Json = Record<string, unknown>;

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Descriptor = { id: string; type: string; transports?: string[] };

function descriptors(list: Descriptor[] | undefined): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((d) => ({ ...d, id: b64urlToBuf(d.id) })) as PublicKeyCredentialDescriptor[] | undefined;
}

/** True when this browser can do WebAuthn at all. */
export function webauthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

/** Turns the server's registration options into what navigator.credentials.create wants and runs it. */
export async function createCredential(options: Json): Promise<Json> {
  const pk = (options.publicKey ?? options) as Json & {
    challenge: string;
    user: { id: string };
    excludeCredentials?: Descriptor[];
  };
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...(pk as object),
      challenge: b64urlToBuf(pk.challenge),
      user: { ...(pk.user as object), id: b64urlToBuf(pk.user.id) },
      excludeCredentials: descriptors(pk.excludeCredentials),
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64url(r.clientDataJSON),
      attestationObject: bufToB64url(r.attestationObject),
      transports: typeof r.getTransports === "function" ? r.getTransports() : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

/** Turns the server's assertion options into what navigator.credentials.get wants and runs it. */
export async function getAssertion(options: Json): Promise<Json> {
  const pk = (options.publicKey ?? options) as Json & { challenge: string; allowCredentials?: Descriptor[] };
  const cred = (await navigator.credentials.get({
    publicKey: {
      ...(pk as object),
      challenge: b64urlToBuf(pk.challenge),
      allowCredentials: descriptors(pk.allowCredentials),
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bufToB64url(r.clientDataJSON),
      authenticatorData: bufToB64url(r.authenticatorData),
      signature: bufToB64url(r.signature),
      userHandle: bufToB64url(r.userHandle),
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}
