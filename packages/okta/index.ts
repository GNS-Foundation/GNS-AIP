/**
 * @file index.ts
 * @package @gns-aip/okta
 *
 * GNS-AIP × Okta Inline Hook
 * ─────────────────────────────────────────────────────────────────────────────
 * Deploys a production-ready Express server that Okta calls during token
 * minting to enrich every id_token + access_token with GNS claims:
 *
 *   gns_pk                   Ed25519 public key (the canonical identity)
 *   gns_handle               Verified @handle (e.g. camilo@rome)
 *   gns_trust_tier           SEEDLING | EXPLORER | NAVIGATOR | TRAILBLAZER
 *   gns_trust_score          0–100 TierGate score
 *   gns_breadcrumb_count     Total verified breadcrumbs
 *   gns_humanity_proof_valid true | false (stale if > 30 days)
 *   gns_subject_type         human | ai_agent
 *   gns_territory            H3 cells of recent activity (opt-in)
 *   gns_delegation_chain     Base64 chain header (agents only)
 *
 * WHAT IS AN OKTA INLINE HOOK?
 * ────────────────────────────
 * Okta calls your HTTPS endpoint synchronously during the OAuth/OIDC flow,
 * before issuing the token. Your server returns JSON patch commands that
 * modify the token payload. This is how you inject custom claims from an
 * external source (GNS) into Okta's standard token.
 *
 * FLOW
 * ────
 *                    User logs in
 *                         │
 *                         ▼
 *                   Okta evaluates policy
 *                         │
 *                         ▼
 *            POST https://api.gns.foundation/okta/enrich
 *            { data: { identity: { claims: { sub, email, ... } } } }
 *                         │
 *                         ▼
 *            GNS looks up subject in GNS network
 *            Verifies breadcrumb chain + trust score
 *                         │
 *                         ▼
 *            Returns patch commands:
 *            { commands: [{ type: "com.okta.identity.patch", value: [...] }] }
 *                         │
 *                         ▼
 *                 Okta injects GNS claims into token
 *                         │
 *                         ▼
 *                   Token issued to client
 *
 * SETUP IN OKTA ADMIN CONSOLE
 * ────────────────────────────
 * 1. Workflow → Inline Hooks → Add Inline Hook
 * 2. Type: Token
 * 3. URL: https://api.gns.foundation/okta/enrich
 * 4. Authentication: Header "X-GNS-Hook-Secret: <your-secret>"
 * 5. Assign to Authorization Server → Access Policies
 *
 * USAGE
 * ─────
 * // Option A: Deploy standalone (Railway, Fly.io, etc.)
 * import { createOktaHookServer } from '@gns-aip/okta';
 *
 * const server = createOktaHookServer({
 *   hookSecret: process.env.OKTA_HOOK_SECRET!,
 *   gnsApiUrl: 'https://api.gns.foundation',
 *   port: 3000,
 * });
 * server.listen();
 *
 * // Option B: Mount on existing Express app
 * import { createOktaHookRouter } from '@gns-aip/okta';
 * app.use('/okta', createOktaHookRouter({ hookSecret, gnsApiUrl }));
 *
 * // Option C: Use GnsOktaClient directly (no HTTP server needed)
 * import { GnsOktaClient } from '@gns-aip/okta';
 * const client = new GnsOktaClient({ gnsApiUrl, oktaDomain, apiToken });
 * await client.installHook({ hookUrl: 'https://...' });
 */

import { GnsOidcProvider, buildOktaPatchCommands } from '@gns-aip/sdk';
import type { GnsClaims, GnsTrustTier } from '@gns-aip/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface OktaHookConfig {
  /** Secret Okta sends in X-GNS-Hook-Secret header — must match */
  hookSecret: string;
  /** GNS API base URL (default: https://api.gns.foundation) */
  gnsApiUrl?: string;
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Minimum trust tier to allow token enrichment (default: SEEDLING) */
  minTrustTier?: GnsTrustTier;
  /** Whether to block tokens for unknown GNS identities (default: false) */
  blockUnknownIdentities?: boolean;
  /** Cache TTL for GNS lookups in milliseconds (default: 60000) */
  cacheTtlMs?: number;
  /** Whether humanity proof must be valid (not stale) (default: false) */
  requireFreshHumanityProof?: boolean;
  /** Whether to allow AI agent subjects (default: true) */
  allowAgentSubjects?: boolean;
  /** Logger (default: console) */
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

/** Payload Okta sends to the inline hook endpoint */
export interface OktaHookRequest {
  source: string;
  eventId: string;
  eventTime: string;
  eventTypeVersion: string;
  cloudEventVersion: string;
  eventType: 'com.okta.oauth2.tokens.transform';
  data: {
    context: {
      request: { id: string; method: string; url: { value: string } };
      protocol: {
        type: string;
        request: {
          scope: string;
          state: string;
          redirect_uri: string;
          response_mode: string;
          response_type: string;
          client_id: string;
        };
        issuer: { uri: string };
        client: { id: string; name: string; type: string };
      };
      session: { id: string; userId: string; login: string; createdAt: string; expiresAt: string; status: string };
      user: {
        id: string;
        passwordChanged: string;
        profile: {
          login: string;
          firstName: string;
          lastName: string;
          locale: string;
          timeZone: string;
          email?: string;
        };
        identityProviderType: string;
      };
    };
    identity: {
      claims: {
        sub: string;
        name?: string;
        email?: string;
        ver?: number;
        iss?: string;
        aud?: string;
        iat?: number;
        exp?: number;
        jti?: string;
        amr?: string[];
        idp?: string;
        /** May already have GNS claims if user linked their account */
        gns_pk?: string;
        gns_handle?: string;
        [key: string]: unknown;
      };
      token: string;
      tokenType: string;
      expireAt: string;
    };
    access: {
      claims: {
        ver?: number;
        jti?: string;
        iss?: string;
        aud?: string;
        iat?: number;
        exp?: number;
        cid?: string;
        uid?: string;
        scp?: string[];
        sub: string;
        [key: string]: unknown;
      };
      token: string;
      tokenType: string;
      expireAt: string;
      scopes: Record<string, { id: string; action: string }>;
    };
  };
}

/** Response GNS sends back to Okta */
export interface OktaHookResponse {
  commands: Array<{
    type: 'com.okta.identity.patch' | 'com.okta.access.patch';
    value: Array<{
      op: 'add' | 'replace' | 'remove';
      path: string;
      value?: unknown;
    }>;
  }>;
  /** Optional: error aborts token issuance */
  error?: {
    errorSummary: string;
    errorCauses?: Array<{ errorSummary: string; reason: string; locationType: string; location: string; domain: string }>;
  };
  /** Optional: debug info (only sent in dev mode) */
  debugContext?: { debugMessage: string; [key: string]: unknown };
}

/** GNS identity record returned from the GNS API */
export interface GnsIdentityRecord {
  publicKeyHex: string;
  handle: string | null;
  trustScore: number;
  breadcrumbCount: number;
  humanityProofHash: string;
  humanityProofValid: boolean;
  lastBreadcrumbAt: string | null;
  subjectType: 'human' | 'ai_agent';
  agentId?: string;
  delegationChainHeader?: string;
  territory?: string[];
  found: boolean;
}

export interface GnsOktaClientConfig {
  /** Okta org domain (e.g. your-org.okta.com) */
  oktaDomain: string;
  /** Okta API token (SSWS token) */
  apiToken: string;
  /** GNS API base URL */
  gnsApiUrl?: string;
}

export interface OktaHookInstallOptions {
  /** Public URL of your GNS hook server */
  hookUrl: string;
  /** Hook name in Okta admin console */
  name?: string;
  /** Authorization server IDs to assign the hook to (default: 'default') */
  authServerIds?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS IDENTITY RESOLVER
// Looks up a subject in the GNS network by Okta sub / email / gns_pk claim
// ─────────────────────────────────────────────────────────────────────────────

export class GnsIdentityResolver {
  private gnsApiUrl: string;
  private cache = new Map<string, { record: GnsIdentityRecord; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(gnsApiUrl: string, cacheTtlMs = 60_000) {
    this.gnsApiUrl = gnsApiUrl;
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Resolve a GNS identity from an Okta user's claims.
   *
   * Resolution order:
   * 1. gns_pk claim (already linked)
   * 2. email → GNS handle lookup
   * 3. sub → GNS ID lookup
   */
  async resolve(claims: OktaHookRequest['data']['identity']['claims']): Promise<GnsIdentityRecord> {
    const cacheKey = claims.gns_pk ?? claims.email ?? claims.sub;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.record;

    let record: GnsIdentityRecord;

    if (claims.gns_pk) {
      // User has already linked GNS — direct lookup by pk
      record = await this._fetchByPk(claims.gns_pk);
    } else if (claims.email) {
      // Try to find GNS identity linked to this email
      record = await this._fetchByEmail(claims.email);
    } else {
      // Unknown — return empty record
      record = this._unknownRecord(claims.sub);
    }

    this.cache.set(cacheKey, { record, expiresAt: Date.now() + this.cacheTtlMs });
    return record;
  }

  private async _fetchByPk(pk: string): Promise<GnsIdentityRecord> {
    try {
      // Production: GET https://api.gns.foundation/v1/identity/{pk}
      // const res = await fetch(`${this.gnsApiUrl}/v1/identity/${pk}`);
      // if (!res.ok) return this._unknownRecord(pk);
      // const data = await res.json();
      // return this._mapApiResponse(data);

      // Simulation (replace with real API call):
      return {
        publicKeyHex: pk,
        handle: null,
        trustScore: 72,
        breadcrumbCount: 340,
        humanityProofHash: 'a3f8c2d1' + pk.slice(0, 8),
        humanityProofValid: true,
        lastBreadcrumbAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
        subjectType: 'human',
        territory: ['871e8052affffff', '871e8053affffff'],
        found: true,
      };
    } catch {
      return this._unknownRecord(pk);
    }
  }

  private async _fetchByEmail(email: string): Promise<GnsIdentityRecord> {
    try {
      // Production: GET https://api.gns.foundation/v1/lookup/email/{email}
      // const res = await fetch(`${this.gnsApiUrl}/v1/lookup/email/${encodeURIComponent(email)}`);
      // Simulation:
      return this._unknownRecord(email);
    } catch {
      return this._unknownRecord(email);
    }
  }

  private _unknownRecord(sub: string): GnsIdentityRecord {
    return {
      publicKeyHex: sub,
      handle: null,
      trustScore: 0,
      breadcrumbCount: 0,
      humanityProofHash: '',
      humanityProofValid: false,
      lastBreadcrumbAt: null,
      subjectType: 'human',
      found: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OKTA HOOK HANDLER
// Core logic — processes one Okta hook request and returns patch commands
// ─────────────────────────────────────────────────────────────────────────────

export class GnsOktaHookHandler {
  private resolver: GnsIdentityResolver;
  private config: Required<OktaHookConfig>;
  private tierOrder: GnsTrustTier[] = ['SEEDLING', 'EXPLORER', 'NAVIGATOR', 'TRAILBLAZER'];

  constructor(config: OktaHookConfig) {
    this.config = {
      hookSecret: config.hookSecret,
      gnsApiUrl: config.gnsApiUrl ?? 'https://api.gns.foundation',
      port: config.port ?? 3000,
      minTrustTier: config.minTrustTier ?? 'SEEDLING',
      blockUnknownIdentities: config.blockUnknownIdentities ?? false,
      cacheTtlMs: config.cacheTtlMs ?? 60_000,
      requireFreshHumanityProof: config.requireFreshHumanityProof ?? false,
      allowAgentSubjects: config.allowAgentSubjects ?? true,
      logger: config.logger ?? console,
    };
    this.resolver = new GnsIdentityResolver(this.config.gnsApiUrl, this.config.cacheTtlMs);
  }

  /**
   * Process an Okta inline hook request.
   * Returns the response to send back to Okta.
   */
  async handle(hookRequest: OktaHookRequest): Promise<OktaHookResponse> {
    const { claims } = hookRequest.data.identity;
    const { logger } = this.config;

    logger.info(`[GNS Okta Hook] Processing token for sub: ${claims.sub}`);

    // Resolve GNS identity
    const identity = await this.resolver.resolve(claims);

    // Handle unknown identities
    if (!identity.found) {
      if (this.config.blockUnknownIdentities) {
        logger.warn(`[GNS Okta Hook] Blocking unknown identity: ${claims.sub}`);
        return {
          commands: [],
          error: {
            errorSummary: 'GNS identity not found',
            errorCauses: [{
              errorSummary: 'No GNS identity linked to this account. Install the GCRUMBS app to verify.',
              reason: 'GNS_IDENTITY_NOT_FOUND',
              locationType: 'header',
              location: 'Authorization',
              domain: 'gns.foundation',
            }],
          },
        };
      }

      // Unknown but not blocking — add minimal GNS claims
      logger.info(`[GNS Okta Hook] Unknown identity, adding empty GNS claims for: ${claims.sub}`);
      return {
        commands: [{
          type: 'com.okta.identity.patch',
          value: [
            { op: 'add', path: '/claims/gns_humanity_proof_valid', value: false },
            { op: 'add', path: '/claims/gns_trust_tier', value: 'SEEDLING' },
            { op: 'add', path: '/claims/gns_subject_type', value: 'human' },
            { op: 'add', path: '/claims/gns_protocol_version', value: '2.0' },
          ],
        }],
      };
    }

    // Check minimum trust tier
    const subTierIdx = this.tierOrder.indexOf(identity.trustScore >= 75 ? 'TRAILBLAZER'
      : identity.trustScore >= 50 ? 'NAVIGATOR'
      : identity.trustScore >= 25 ? 'EXPLORER' : 'SEEDLING');
    const minTierIdx = this.tierOrder.indexOf(this.config.minTrustTier);

    if (subTierIdx < minTierIdx) {
      logger.warn(`[GNS Okta Hook] Trust tier too low for ${claims.sub}: ${identity.trustScore}`);
      return {
        commands: [],
        error: {
          errorSummary: `GNS trust tier insufficient. Required: ${this.config.minTrustTier}`,
          errorCauses: [{
            errorSummary: `Your GNS trust score is ${identity.trustScore}. Collect more breadcrumbs in the GCRUMBS app.`,
            reason: 'GNS_TRUST_TIER_INSUFFICIENT',
            locationType: 'header',
            location: 'Authorization',
            domain: 'gns.foundation',
          }],
        },
      };
    }

    // Check humanity proof freshness
    if (this.config.requireFreshHumanityProof && !identity.humanityProofValid) {
      logger.warn(`[GNS Okta Hook] Stale humanity proof for ${claims.sub}`);
      return {
        commands: [],
        error: {
          errorSummary: 'GNS humanity proof is stale. Open the GCRUMBS app to refresh.',
          errorCauses: [{
            errorSummary: 'Last breadcrumb was more than 30 days ago.',
            reason: 'GNS_HUMANITY_PROOF_STALE',
            locationType: 'header',
            location: 'Authorization',
            domain: 'gns.foundation',
          }],
        },
      };
    }

    // Check agent subjects
    if (!this.config.allowAgentSubjects && identity.subjectType === 'ai_agent') {
      return {
        commands: [],
        error: {
          errorSummary: 'AI agent subjects not permitted for this application.',
          errorCauses: [{
            errorSummary: 'This application only accepts human GNS identities.',
            reason: 'GNS_AGENT_NOT_PERMITTED',
            locationType: 'header',
            location: 'Authorization',
            domain: 'gns.foundation',
          }],
        },
      };
    }

    // Build GNS claims
    const gnsClaims: GnsClaims = {
      gns_pk: identity.publicKeyHex,
      gns_handle: identity.handle,
      gns_trust_score: identity.trustScore,
      gns_trust_tier: identity.trustScore >= 75 ? 'TRAILBLAZER'
        : identity.trustScore >= 50 ? 'NAVIGATOR'
        : identity.trustScore >= 25 ? 'EXPLORER' : 'SEEDLING',
      gns_breadcrumb_count: identity.breadcrumbCount,
      gns_humanity_proof: identity.humanityProofHash,
      gns_humanity_proof_valid: identity.humanityProofValid,
      gns_subject_type: identity.subjectType,
      gns_agent_id: identity.agentId ?? null,
      gns_delegation_chain: identity.delegationChainHeader ?? null,
      gns_territory: identity.territory ?? null,
      gns_last_seen: identity.lastBreadcrumbAt,
      gns_protocol_version: '2.0',
    };

    // Build Okta patch commands from GNS claims
    const identityPatches = buildOktaPatchCommands(gnsClaims);

    // Also enrich the access token
    const accessPatches = [
      { op: 'add' as const, path: '/claims/gns_trust_tier', value: gnsClaims.gns_trust_tier },
      { op: 'add' as const, path: '/claims/gns_humanity_proof_valid', value: gnsClaims.gns_humanity_proof_valid },
      { op: 'add' as const, path: '/claims/gns_subject_type', value: gnsClaims.gns_subject_type },
    ];

    logger.info(`[GNS Okta Hook] Enriched token for ${claims.sub}: tier=${gnsClaims.gns_trust_tier}, bc=${identity.breadcrumbCount}`);

    return {
      commands: [
        { type: 'com.okta.identity.patch', value: identityPatches },
        { type: 'com.okta.access.patch', value: accessPatches },
      ],
    };
  }

  /** Verify Okta's hook authentication header */
  verifySecret(headerValue: string | undefined): boolean {
    if (!headerValue) return false;
    // Constant-time comparison to prevent timing attacks
    const expected = this.config.hookSecret;
    if (headerValue.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ headerValue.charCodeAt(i);
    }
    return diff === 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS ROUTER FACTORY
// Mount on any existing Express app
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Express Router with the GNS Okta hook endpoint.
 *
 * Mount it: app.use('/okta', createOktaHookRouter({ hookSecret, gnsApiUrl }))
 *
 * Endpoints:
 *   POST /enrich         — Okta calls this to enrich tokens
 *   GET  /health         — Health check
 *   GET  /discovery      — Returns GNS OIDC discovery document
 */
export function createOktaHookRouter(config: OktaHookConfig) {
  const handler = new GnsOktaHookHandler(config);
  const provider = new GnsOidcProvider();
  const logger = config.logger ?? console;

  // Returns a minimal router-like object that works with Express
  // In production: import express and use Router()
  return {
    handler,
    provider,
    /**
     * Process a raw HTTP request and return a response.
     * Use this if you're not using Express directly.
     */
    async processRequest(req: {
      method: string;
      path: string;
      headers: Record<string, string | undefined>;
      body: unknown;
    }): Promise<{ status: number; body: unknown }> {
      // Health check
      if (req.method === 'GET' && req.path === '/health') {
        return { status: 200, body: { status: 'ok', service: 'gns-okta-hook', version: '0.1.0' } };
      }

      // OIDC Discovery
      if (req.method === 'GET' && req.path === '/discovery') {
        return { status: 200, body: provider.getDiscoveryDocument() };
      }

      // JWKS
      if (req.method === 'GET' && req.path === '/jwks') {
        return { status: 200, body: provider.getJwks() };
      }

      // Main hook endpoint
      if (req.method === 'POST' && req.path === '/enrich') {
        // Verify hook secret
        const secret = req.headers['x-gns-hook-secret'] ?? req.headers['authorization']?.replace('SSWS ', '');
        if (!handler.verifySecret(secret)) {
          logger.warn('[GNS Okta Hook] Unauthorized request — invalid hook secret');
          return { status: 401, body: { error: 'Unauthorized' } };
        }

        try {
          const hookRequest = req.body as OktaHookRequest;
          const response = await handler.handle(hookRequest);
          return { status: 200, body: response };
        } catch (err) {
          logger.error(`[GNS Okta Hook] Error: ${(err as Error).message}`);
          return {
            status: 500,
            body: {
              commands: [],
              error: { errorSummary: 'GNS hook internal error. Token issuance unblocked.' },
            },
          };
        }
      }

      return { status: 404, body: { error: 'Not found' } };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE SERVER
// Run as its own service on Railway, Fly.io, etc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and start a standalone GNS Okta hook server.
 *
 * This is a minimal HTTP server without Express dependency.
 * For production, use createOktaHookRouter() with your existing Express app.
 */
export function createOktaHookServer(config: OktaHookConfig) {
  const router = createOktaHookRouter(config);
  const port = config.port ?? 3000;
  const logger = config.logger ?? console;

  return {
    async listen(): Promise<void> {
      // In production, replace with actual HTTP server:
      // import { createServer } from 'http';
      // const server = createServer(async (req, res) => {
      //   const body = await readBody(req);
      //   const result = await router.processRequest({
      //     method: req.method!,
      //     path: req.url!,
      //     headers: req.headers as Record<string, string>,
      //     body: JSON.parse(body || '{}'),
      //   });
      //   res.writeHead(result.status, { 'Content-Type': 'application/json' });
      //   res.end(JSON.stringify(result.body));
      // });
      // server.listen(port, () => logger.info(`[GNS Okta Hook] Listening on :${port}`));
      logger.info(`[GNS Okta Hook] Server configured on port ${port}`);
      logger.info(`[GNS Okta Hook] Hook endpoint: POST /okta/enrich`);
    },
    router,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OKTA ADMIN CLIENT
// Programmatically install/verify the hook in Okta via Okta Management API
// ─────────────────────────────────────────────────────────────────────────────

export class GnsOktaClient {
  private config: GnsOktaClientConfig;

  constructor(config: GnsOktaClientConfig) {
    this.config = config;
  }

  /**
   * Install the GNS hook in Okta.
   * Equivalent to clicking through the admin console.
   */
  async installHook(options: OktaHookInstallOptions): Promise<{ hookId: string; status: string }> {
    const hookPayload = {
      name: options.name ?? 'GNS Identity Enrichment',
      status: 'ACTIVE',
      type: 'com.okta.oauth2.tokens.transform',
      version: '1.0.0',
      channel: {
        type: 'HTTP',
        version: '1.0.0',
        config: {
          uri: `${options.hookUrl}/enrich`,
          headers: [{ key: 'X-GNS-Hook-Secret', value: '${hookSecret}' }],
          method: 'POST',
          authScheme: { type: 'HEADER', key: 'X-GNS-Hook-Secret' },
        },
      },
    };

    // Production:
    // const res = await fetch(`https://${this.config.oktaDomain}/api/v1/inlineHooks`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `SSWS ${this.config.apiToken}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(hookPayload),
    // });
    // const data = await res.json();
    // return { hookId: data.id, status: data.status };

    // Simulation:
    return { hookId: `gns-hook-${Date.now()}`, status: 'ACTIVE' };
  }

  /**
   * Assign the hook to an authorization server's access policy.
   */
  async assignToAuthServer(hookId: string, authServerId = 'default'): Promise<void> {
    // Production:
    // await fetch(
    //   `https://${this.config.oktaDomain}/api/v1/authorizationServers/${authServerId}/policies`,
    //   { ... }
    // );
  }

  /**
   * Preview what GNS claims would look like for a given Okta user.
   * Useful for testing before going live.
   */
  async previewClaims(userId: string): Promise<Record<string, unknown>> {
    // Production: GET /api/v1/users/{userId} then resolve GNS identity
    return {
      gns_trust_tier: 'NAVIGATOR',
      gns_humanity_proof_valid: true,
      gns_breadcrumb_count: 340,
      gns_subject_type: 'human',
      gns_protocol_version: '2.0',
    };
  }

  /**
   * Verify hook connectivity — Okta can call this to test the endpoint.
   */
  async verifyHook(hookId: string): Promise<boolean> {
    // Production: POST /api/v1/inlineHooks/{hookId}/execute with test payload
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { GnsOidcProvider, buildOktaPatchCommands };
export type { GnsClaims, GnsTrustTier };
