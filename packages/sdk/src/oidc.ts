/**
 * @file oidc.ts
 * @module @gns-aip/sdk
 *
 * GNS OIDC Federation Spec
 * ────────────────────────
 * Enables GNS to act as an OIDC-compatible Identity Provider (IdP) that
 * enriches standard OIDC tokens with GNS-native claims:
 *   - gns_handle          → verified @handle
 *   - gns_trust_score     → 0–100 TierGate score
 *   - gns_trust_tier      → SEEDLING | EXPLORER | NAVIGATOR | TRAILBLAZER
 *   - gns_breadcrumb_count → number of verified breadcrumbs
 *   - gns_humanity_proof  → proof-of-trajectory attestation (hash)
 *   - gns_territory       → H3 cells of recent activity (optional, privacy-gated)
 *   - gns_agent_id        → if subject is an AI agent, its GNS-AIP identity
 *   - gns_delegation_chain → if agent, base64-encoded chain header
 *   - gns_pk              → Ed25519 public key (hex)
 *
 * Integration Patterns:
 *
 *   A) As standalone IdP:
 *      Browser app redirects to https://id.gns.foundation/authorize
 *      Returns standard OIDC id_token + GNS custom claims
 *
 *   B) As Okta/Ping plugin (IdP chain):
 *      Okta calls GNS /verify endpoint, receives GNS claims
 *      Okta injects them into its own id_token as namespaced claims
 *      Message to Okta: "Add humanity proof you cannot generate natively"
 *
 *   C) As Azure AD External Identity Provider:
 *      Azure calls GNS as external claims provider
 *      GNS returns humanity + jurisdiction enrichment
 *
 * Discovery document: GET /.well-known/openid-configuration
 * JWKS endpoint:      GET /.well-known/jwks.json
 *
 * Standard compliance: OpenID Connect Core 1.0 (RFC 6749 / RFC 7519)
 * GNS extension spec: TrIP IETF draft-ayerbe-trip-protocol-02
 */

import nacl from 'tweetnacl';


// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type GnsTrustTier = 'SEEDLING' | 'EXPLORER' | 'NAVIGATOR' | 'TRAILBLAZER';
export type SubjectType = 'human' | 'ai_agent';

/**
 * GNS custom claims injected into OIDC id_token.
 * Namespace: https://gns.foundation/claims/
 * Shorthand prefix used in JWT: gns_
 */
export interface GnsClaims {
  /** Verified @handle (null if not yet claimed) */
  gns_handle: string | null;
  /** Ed25519 public key hex — the canonical identity primitive */
  gns_pk: string;
  /** TierGate trust score 0–100 */
  gns_trust_score: number;
  /** Human-readable trust tier */
  gns_trust_tier: GnsTrustTier;
  /** Total verified breadcrumbs in chain */
  gns_breadcrumb_count: number;
  /**
   * Proof-of-Trajectory attestation hash.
   * SHA-256 of the most recent epoch root + timestamp.
   * Verifiers can check this against the GNS network.
   */
  gns_humanity_proof: string;
  /**
   * Whether the humanity proof is currently valid (not stale).
   * Becomes false if last breadcrumb > 30 days old.
   */
  gns_humanity_proof_valid: boolean;
  /** Subject type — differentiates human vs AI agent subjects */
  gns_subject_type: SubjectType;
  /**
   * For AI agents: the GNS-AIP agent identity pk.
   * Null for human subjects.
   */
  gns_agent_id: string | null;
  /**
   * For AI agents: base64-encoded delegation chain header.
   * Null for human subjects.
   * Relying parties MUST verify this chain if present.
   */
  gns_delegation_chain: string | null;
  /**
   * H3 territory cells of recent activity.
   * Only included if user has enabled territory disclosure.
   * Resolution 7 (≈ 5km² hexagons) — privacy-preserving granularity.
   */
  gns_territory: string[] | null;
  /** ISO-8601 timestamp of most recent breadcrumb */
  gns_last_seen: string | null;
  /** Protocol version */
  gns_protocol_version: '2.0';
}

/** Standard OIDC id_token payload + GNS claims */
export interface GnsIdToken extends GnsClaims {
  // ── Standard OIDC claims ────────────────────────────────────────────────
  /** Issuer — GNS Foundation IdP URL */
  iss: string;
  /** Subject — Ed25519 public key hex (same as gns_pk) */
  sub: string;
  /** Audience — client_id of the relying party */
  aud: string | string[];
  /** Expiry (unix timestamp) */
  exp: number;
  /** Issued at (unix timestamp) */
  iat: number;
  /** Auth time (unix timestamp) */
  auth_time: number;
  /** Nonce from authorization request */
  nonce?: string;
  /** JWT ID */
  jti: string;
  /** Access token hash (OIDC spec requirement) */
  at_hash?: string;
  /** Authorized party */
  azp?: string;
}

/** OIDC Discovery Document (/.well-known/openid-configuration) */
export interface GnsOidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  registration_endpoint: string;
  introspection_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
  response_types_supported: string[];
  response_modes_supported: string[];
  grant_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  claims_supported: string[];
  claims_parameter_supported: boolean;
  request_parameter_supported: boolean;
  request_uri_parameter_supported: boolean;
  /** GNS extension: minimum trust tier for this RP */
  'x-gns-min-trust-tier'?: GnsTrustTier;
  /** GNS extension: whether delegation chain verification is required */
  'x-gns-require-delegation-chain'?: boolean;
}

/** OIDC Client registration for relying parties */
export interface GnsClientRegistration {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  /** Required GNS scopes beyond 'openid' */
  gns_required_scopes: GnsScope[];
  /** Minimum trust tier to access this client */
  min_trust_tier: GnsTrustTier;
  /** Whether this RP accepts AI agent subjects */
  allow_agent_subjects: boolean;
  /** Whether territory disclosure is required */
  require_territory: boolean;
  /** Client public key for JWK-based auth */
  jwks_uri?: string;
}

/**
 * GNS OIDC Scopes
 * Standard: openid, profile, email
 * GNS extension scopes:
 */
export type GnsScope =
  | 'openid'           // Required — gns_pk + gns_subject_type
  | 'profile'          // gns_handle + gns_trust_tier
  | 'gns:trust'        // gns_trust_score + gns_breadcrumb_count
  | 'gns:humanity'     // gns_humanity_proof + gns_humanity_proof_valid
  | 'gns:territory'    // gns_territory (requires explicit user consent)
  | 'gns:agent'        // gns_agent_id + gns_delegation_chain
  | 'gns:full';        // All GNS claims (requires high trust)

/** OIDC Userinfo endpoint response */
export interface GnsUserinfo {
  sub: string;
  gns_handle: string | null;
  gns_pk: string;
  gns_trust_score: number;
  gns_trust_tier: GnsTrustTier;
  gns_breadcrumb_count: number;
  gns_humanity_proof_valid: boolean;
  gns_subject_type: SubjectType;
  gns_last_seen: string | null;
}

/** Introspection token response */
export interface GnsTokenIntrospection {
  active: boolean;
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  scope: string;
  gns_pk: string;
  gns_trust_tier: GnsTrustTier;
  gns_subject_type: SubjectType;
  /** If agent: chain valid boolean */
  gns_chain_valid?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNALS
// ─────────────────────────────────────────────────────────────────────────────

const GNS_ISSUER = 'https://id.gns.foundation';
const GNS_PROTOCOL_VERSION = '2.0' as const;

function randomHex(bytes: number): string {
  return Array.from(nacl.randomBytes(bytes))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function uint8ToHex(u8: Uint8Array): string {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function trustTierFromScore(score: number): GnsTrustTier {
  if (score >= 75) return 'TRAILBLAZER';
  if (score >= 50) return 'NAVIGATOR';
  if (score >= 25) return 'EXPLORER';
  return 'SEEDLING';
}

function trustTierFromBreadcrumbs(count: number): GnsTrustTier {
  if (count >= 1000) return 'TRAILBLAZER';
  if (count >= 250) return 'NAVIGATOR';
  if (count >= 50) return 'EXPLORER';
  return 'SEEDLING';
}

// ─────────────────────────────────────────────────────────────────────────────
// OIDC PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

export class GnsOidcProvider {
  private issuer: string;
  private signingKey: nacl.SignKeyPair;
  private registeredClients = new Map<string, GnsClientRegistration>();

  constructor(opts?: { issuer?: string; signingKeyPair?: nacl.SignKeyPair }) {
    this.issuer = opts?.issuer ?? GNS_ISSUER;
    this.signingKey = opts?.signingKeyPair ?? nacl.sign.keyPair();
  }

  /**
   * Register a relying party client (Okta, Ping, your app, etc.)
   */
  registerClient(registration: GnsClientRegistration): void {
    this.registeredClients.set(registration.client_id, registration);
  }

  /**
   * Issue a GNS id_token for a verified subject.
   *
   * In production this is called after the GNS backend has:
   * 1. Verified the subject's breadcrumb chain
   * 2. Computed their trust score
   * 3. Validated any delegation certs (for agents)
   */
  issueIdToken(
    subject: {
      publicKeyHex: string;
      handle: string | null;
      trustScore: number;
      breadcrumbCount: number;
      humanityProofHash: string;
      lastBreadcrumbAt: string | null;
      subjectType: SubjectType;
      agentId?: string;
      delegationChainHeader?: string;
      territory?: string[];
    },
    opts: {
      clientId: string;
      nonce?: string;
      scopes: GnsScope[];
      ttlSeconds?: number;
    }
  ): string {
    const client = this.registeredClients.get(opts.clientId);
    const now = Math.floor(Date.now() / 1000);
    const ttl = opts.ttlSeconds ?? 3600;
    const humanityProofValid = subject.lastBreadcrumbAt
      ? (Date.now() - new Date(subject.lastBreadcrumbAt).getTime()) < 30 * 86400 * 1000
      : false;

    // Build GNS claims based on requested scopes
    const gnsClaims: GnsClaims = {
      gns_pk: subject.publicKeyHex,
      gns_subject_type: subject.subjectType,
      gns_handle: opts.scopes.includes('profile') ? subject.handle : null,
      gns_trust_score: opts.scopes.includes('gns:trust') ? subject.trustScore : 0,
      gns_trust_tier: trustTierFromBreadcrumbs(subject.breadcrumbCount),
      gns_breadcrumb_count: opts.scopes.includes('gns:trust') ? subject.breadcrumbCount : 0,
      gns_humanity_proof: opts.scopes.includes('gns:humanity') ? subject.humanityProofHash : '',
      gns_humanity_proof_valid: opts.scopes.includes('gns:humanity') ? humanityProofValid : false,
      gns_agent_id: (opts.scopes.includes('gns:agent') && subject.agentId) ? subject.agentId : null,
      gns_delegation_chain: (opts.scopes.includes('gns:agent') && subject.delegationChainHeader)
        ? subject.delegationChainHeader : null,
      gns_territory: (opts.scopes.includes('gns:territory') && subject.territory)
        ? subject.territory : null,
      gns_last_seen: subject.lastBreadcrumbAt,
      gns_protocol_version: GNS_PROTOCOL_VERSION,
    };

    const payload: GnsIdToken = {
      ...gnsClaims,
      iss: this.issuer,
      sub: subject.publicKeyHex,
      aud: opts.clientId,
      exp: now + ttl,
      iat: now,
      auth_time: now,
      jti: randomHex(16),
      ...(opts.nonce ? { nonce: opts.nonce } : {}),
    };

    return this._signJwt(payload);
  }

  /**
   * Verify a GNS id_token. Returns decoded payload or throws.
   * Use this in your backend middleware.
   */
  verifyIdToken(token: string): GnsIdToken {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('[GNS OIDC] Malformed JWT');
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    const msgBytes = new TextEncoder().encode(signingInput);
    const isValid = nacl.sign.detached.verify(msgBytes, sigBytes, this.signingKey.publicKey);
    if (!isValid) throw new Error('[GNS OIDC] Invalid signature');
    const payloadJson = atob(payloadB64.replace(/-/g,'+').replace(/_/g,'/'));
    const payload: GnsIdToken = JSON.parse(payloadJson);
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('[GNS OIDC] Token expired');
    if (payload.iss !== this.issuer) throw new Error('[GNS OIDC] Issuer mismatch');
    return payload;
  }

  /**
   * Generate the OIDC discovery document.
   * Serve this at /.well-known/openid-configuration
   */
  getDiscoveryDocument(): GnsOidcDiscoveryDocument {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      userinfo_endpoint: `${this.issuer}/userinfo`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      registration_endpoint: `${this.issuer}/register`,
      introspection_endpoint: `${this.issuer}/introspect`,
      revocation_endpoint: `${this.issuer}/revoke`,
      scopes_supported: ['openid', 'profile', 'gns:trust', 'gns:humanity', 'gns:territory', 'gns:agent', 'gns:full'],
      response_types_supported: ['code', 'token', 'id_token', 'code token', 'code id_token', 'token id_token', 'code token id_token'],
      response_modes_supported: ['query', 'fragment', 'form_post'],
      grant_types_supported: ['authorization_code', 'implicit', 'refresh_token', 'client_credentials'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      token_endpoint_auth_methods_supported: ['private_key_jwt', 'client_secret_post', 'none'],
      claims_supported: [
        'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'jti',
        'gns_pk', 'gns_handle', 'gns_trust_score', 'gns_trust_tier',
        'gns_breadcrumb_count', 'gns_humanity_proof', 'gns_humanity_proof_valid',
        'gns_subject_type', 'gns_agent_id', 'gns_delegation_chain',
        'gns_territory', 'gns_last_seen', 'gns_protocol_version',
      ],
      claims_parameter_supported: true,
      request_parameter_supported: true,
      request_uri_parameter_supported: false,
    };
  }

  /**
   * Generate JWKS document for Ed25519 verification key.
   * Serve at /.well-known/jwks.json
   */
  getJwks(): object {
    const pkBytes = this.signingKey.publicKey;
    return {
      keys: [{
        kty: 'OKP',
        crv: 'Ed25519',
        use: 'sig',
        alg: 'EdDSA',
        kid: uint8ToHex(pkBytes).slice(0, 16),
        x: base64url(pkBytes),
      }],
    };
  }

  /**
   * Userinfo endpoint handler.
   * Returns GNS claims for a valid access token subject.
   */
  buildUserinfo(subject: {
    publicKeyHex: string;
    handle: string | null;
    trustScore: number;
    breadcrumbCount: number;
    lastBreadcrumbAt: string | null;
    subjectType: SubjectType;
  }): GnsUserinfo {
    return {
      sub: subject.publicKeyHex,
      gns_pk: subject.publicKeyHex,
      gns_handle: subject.handle,
      gns_trust_score: subject.trustScore,
      gns_trust_tier: trustTierFromBreadcrumbs(subject.breadcrumbCount),
      gns_breadcrumb_count: subject.breadcrumbCount,
      gns_humanity_proof_valid: subject.lastBreadcrumbAt
        ? (Date.now() - new Date(subject.lastBreadcrumbAt).getTime()) < 30 * 86400 * 1000
        : false,
      gns_subject_type: subject.subjectType,
      gns_last_seen: subject.lastBreadcrumbAt,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _signJwt(payload: GnsIdToken): string {
    const header = { alg: 'EdDSA', typ: 'JWT', kid: uint8ToHex(this.signingKey.publicKey).slice(0, 16) };
    const headerB64 = base64url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = nacl.sign.detached(new TextEncoder().encode(signingInput), this.signingKey.secretKey);
    return `${signingInput}.${base64url(sig)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OKTA / PING INTEGRATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the GNS claim set for injection into Okta / Ping identity policies.
 *
 * Okta Inline Hook integration:
 *   Your Okta org calls: POST https://api.gns.foundation/okta/enrich
 *   Body: { userId, idpClaims }
 *   Returns: { commands: [{ type: "com.okta.identity.patch", value: [...] }] }
 *
 * This function produces the `value` array for the Okta patch command.
 */
export function buildOktaPatchCommands(gnsClaims: GnsClaims): Array<{
  op: 'add';
  path: string;
  value: unknown;
}> {
  const claims: Record<string, unknown> = {
    'gns_pk': gnsClaims.gns_pk,
    'gns_handle': gnsClaims.gns_handle,
    'gns_trust_score': gnsClaims.gns_trust_score,
    'gns_trust_tier': gnsClaims.gns_trust_tier,
    'gns_breadcrumb_count': gnsClaims.gns_breadcrumb_count,
    'gns_humanity_proof_valid': gnsClaims.gns_humanity_proof_valid,
    'gns_subject_type': gnsClaims.gns_subject_type,
    'gns_protocol_version': gnsClaims.gns_protocol_version,
  };
  if (gnsClaims.gns_agent_id) claims['gns_agent_id'] = gnsClaims.gns_agent_id;
  if (gnsClaims.gns_delegation_chain) claims['gns_delegation_chain'] = gnsClaims.gns_delegation_chain;
  if (gnsClaims.gns_territory) claims['gns_territory'] = gnsClaims.gns_territory;

  return Object.entries(claims).map(([key, value]) => ({
    op: 'add' as const,
    path: `/claims/${key}`,
    value,
  }));
}

/**
 * Middleware factory for Express/Hono/Fastify backends.
 * Verifies GNS id_token from Authorization header and attaches GNS claims.
 *
 * Usage:
 *   app.use(gnsOidcMiddleware(provider))
 *   app.get('/protected', (req, res) => {
 *     const { gns_trust_tier, gns_humanity_proof_valid } = req.gns;
 *     if (!gns_humanity_proof_valid) return res.status(403).json({ error: 'Humanity proof required' });
 *   })
 */
export function gnsOidcMiddleware(provider: GnsOidcProvider, opts?: {
  minTrustTier?: GnsTrustTier;
  requireHumanityProof?: boolean;
  allowAgents?: boolean;
}) {
  const tierOrder: GnsTrustTier[] = ['SEEDLING', 'EXPLORER', 'NAVIGATOR', 'TRAILBLAZER'];

  return function gnsMiddleware(
    req: { headers: Record<string, string | undefined>; gns?: GnsIdToken },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void
  ): void {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing GNS Bearer token' });
      return;
    }
    try {
      const token = auth.slice(7);
      const claims = provider.verifyIdToken(token);

      // Check trust tier
      if (opts?.minTrustTier) {
        const reqIdx = tierOrder.indexOf(opts.minTrustTier);
        const subIdx = tierOrder.indexOf(claims.gns_trust_tier);
        if (subIdx < reqIdx) {
          res.status(403).json({ error: `Minimum trust tier required: ${opts.minTrustTier}` });
          return;
        }
      }

      // Check humanity proof
      if (opts?.requireHumanityProof && !claims.gns_humanity_proof_valid) {
        res.status(403).json({ error: 'Valid humanity proof required' });
        return;
      }

      // Block agents if not allowed
      if (!opts?.allowAgents && claims.gns_subject_type === 'ai_agent') {
        res.status(403).json({ error: 'AI agent subjects not permitted' });
        return;
      }

      req.gns = claims;
      next();
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
    }
  };
}
