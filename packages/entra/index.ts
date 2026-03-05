/**
 * @file index.ts
 * @package @gns-aip/entra
 *
 * GNS-AIP × Microsoft Entra ID — Custom Claims Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the Microsoft Entra Custom Authentication Extension contract
 * (TokenIssuanceStart event) to enrich every Entra token with GNS claims.
 *
 * CRITICAL DIFFERENCE FROM OKTA
 * ──────────────────────────────
 * Entra's Custom Claims Provider has stricter rules than Okta's Inline Hook:
 *
 *   Constraint              Okta Hook          Entra CCP
 *   ──────────────────────  ─────────────────  ───────────────────────────────
 *   Claim types             Any JSON value     String + String[] only
 *   Auth                    Shared secret      Bearer JWT (Entra validates)
 *   Response format         Patch commands     provideClaimsForToken action
 *   Pre-registration        Not required       claimsMappingPolicy required
 *   Block token issuance    Yes (error obj)    No (can't stop issuance)
 *   Max payload             No stated limit    3KB total
 *
 * ENTRA FLOW
 * ──────────
 *
 *   User authenticates to Entra ID
 *          │
 *          ▼
 *   TokenIssuanceStart event fires
 *          │
 *          ▼
 *   POST https://api.gns.foundation/entra/claims
 *   Authorization: Bearer <Entra-issued JWT>
 *   { type: "microsoft.graph.authenticationEvent.tokenIssuanceStart", ... }
 *          │
 *          ▼
 *   GNS validates bearer JWT (issued by Entra, audience = GNS app registration)
 *   Resolves GNS identity from user.id / user.mail / existing gns_pk attribute
 *          │
 *          ▼
 *   Returns { data: { actions: [{ provideClaimsForToken: { claims: {...} } }] } }
 *   All values are strings (Entra constraint — booleans serialized as "true"/"false")
 *          │
 *          ▼
 *   Entra maps claims via claimsMappingPolicy
 *          │
 *          ▼
 *   Token issued to application with GNS claims
 *
 * SETUP IN AZURE PORTAL
 * ──────────────────────
 * 1. Register GNS as an app in Entra (App Registrations)
 *    - App ID URI: api://gns-claims-provider
 *    - Expose API: CustomAuthenticationExtension.Receive.Payload permission
 *
 * 2. Create Custom Authentication Extension
 *    - Entra ID → Enterprise Applications → Custom auth extensions
 *    - Event: TokenIssuanceStart
 *    - Target URL: https://api.gns.foundation/entra/claims
 *    - App registration: select GNS app from step 1
 *
 * 3. Create Claims Mapping Policy (see GnsEntraClaimsMappingPolicy.generate())
 *    - Upload via Graph API: POST /policies/claimsMappingPolicies
 *
 * 4. Assign to your application
 *    - Enterprise Apps → Your App → Single sign-on → Custom claims provider
 *
 * USAGE
 * ─────
 * // Option A: Standalone server (Railway / Azure Functions)
 * import { createEntraClaimsServer } from '@gns-aip/entra';
 * const server = createEntraClaimsServer({
 *   gnsAppId: process.env.GNS_APP_ID!,
 *   tenantId: process.env.ENTRA_TENANT_ID!,
 *   gnsApiUrl: 'https://api.gns.foundation',
 * });
 * server.listen(3000);
 *
 * // Option B: Mount on existing Express app
 * import { createEntraClaimsRouter } from '@gns-aip/entra';
 * app.use('/entra', createEntraClaimsRouter(config));
 *
 * // Option C: Generate claimsMappingPolicy JSON
 * import { GnsEntraClaimsMappingPolicy } from '@gns-aip/entra';
 * console.log(GnsEntraClaimsMappingPolicy.generate());
 *
 * // Option D: Use Graph API client to configure everything programmatically
 * import { GnsEntraAdminClient } from '@gns-aip/entra';
 * const client = new GnsEntraAdminClient({ tenantId, clientId, clientSecret });
 * await client.registerClaimsProvider({ hookUrl: 'https://...', appId: '...' });
 */

import { GnsOidcProvider, buildOktaPatchCommands } from '@gns-aip/sdk';
import type { GnsClaims, GnsTrustTier } from '@gns-aip/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — Entra Request / Response Contract
// ─────────────────────────────────────────────────────────────────────────────

/** Entra user object sent in TokenIssuanceStart payload */
export interface EntraUser {
  id: string;
  displayName?: string;
  givenName?: string;
  surname?: string;
  mail?: string;
  userPrincipalName?: string;
  companyName?: string;
  userType?: 'Member' | 'Guest';
  preferredLanguage?: string;
  preferredDataLocation?: string;
  onPremisesSamAccountName?: string;
  onPremisesSecurityIdentifier?: string;
  createdDateTime?: string;
}

/** Full TokenIssuanceStart event payload from Entra */
export interface EntraTokenIssuanceStartRequest {
  type: 'microsoft.graph.authenticationEvent.tokenIssuanceStart';
  source: string;
  data: {
    '@odata.type': 'microsoft.graph.onTokenIssuanceStartCalloutData';
    tenantId: string;
    authenticationEventListenerId: string;
    customAuthenticationExtensionId: string;
    authenticationContext: {
      correlationId: string;
      client: { ip: string; locale: string; market: string };
      protocol: string;
      clientServicePrincipal: {
        id: string;
        appId: string;
        appDisplayName: string;
        displayName: string;
      };
      resourceServicePrincipal: {
        id: string;
        appId: string;
        appDisplayName: string;
        displayName: string;
      };
      user: EntraUser;
    };
  };
}

/**
 * Response Entra expects from our REST API.
 * NOTE: All claim values MUST be string or string[] — Entra rejects booleans/numbers.
 */
export interface EntraTokenIssuanceStartResponse {
  data: {
    '@odata.type': 'microsoft.graph.onTokenIssuanceStartResponseData';
    actions: Array<{
      '@odata.type': 'microsoft.graph.tokenIssuanceStart.provideClaimsForToken';
      claims: Record<string, string | string[]>;
    }>;
  };
}

/** GNS claims serialized as strings (Entra constraint) */
export interface EntraGnsClaims {
  gns_pk: string;
  gns_handle: string;                  // "" if not yet claimed
  gns_trust_tier: string;              // "SEEDLING" | "EXPLORER" | "NAVIGATOR" | "TRAILBLAZER"
  gns_trust_score: string;             // "72" (serialized number)
  gns_breadcrumb_count: string;        // "340"
  gns_humanity_proof_valid: string;    // "true" | "false" (Entra doesn't support boolean)
  gns_subject_type: string;            // "human" | "ai_agent"
  gns_protocol_version: string;        // "2.0"
  gns_last_seen: string;               // ISO-8601 or ""
  gns_territory?: string[];            // H3 cells (string array — Entra supports this)
  gns_delegation_chain?: string;       // base64 (agents only)
  gns_agent_id?: string;              // agent pk (agents only)
}

export interface EntraClaimsConfig {
  /** GNS app registration App ID (audience for bearer token validation) */
  gnsAppId: string;
  /** Entra tenant ID (for bearer token issuer validation) */
  tenantId: string;
  /** GNS API base URL */
  gnsApiUrl?: string;
  /** Cache TTL for GNS lookups in ms (default: 60000) */
  cacheTtlMs?: number;
  /** Minimum trust tier — below this, empty GNS claims returned */
  minTrustTier?: GnsTrustTier;
  /** Whether to include territory cells in claims (user must opt-in) */
  includeTerritory?: boolean;
  /** Whether to include delegation chain for agent subjects */
  includeAgentChain?: boolean;
  /** Skip bearer token validation in dev/test (default: false) */
  skipTokenValidation?: boolean;
  logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export interface EntraAdminConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface EntraProviderInstallOptions {
  /** Public URL of GNS claims endpoint */
  hookUrl: string;
  /** GNS app registration App ID */
  appId: string;
  /** Display name in Entra admin console */
  name?: string;
  /** App IDs to assign the claims provider to */
  targetAppIds?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS IDENTITY RESOLVER (Entra-flavoured)
// Resolves Entra user → GNS identity record
// ─────────────────────────────────────────────────────────────────────────────

export interface GnsIdentityRecord {
  publicKeyHex: string;
  handle: string | null;
  trustScore: number;
  breadcrumbCount: number;
  humanityProofValid: boolean;
  lastBreadcrumbAt: string | null;
  subjectType: 'human' | 'ai_agent';
  agentId?: string;
  delegationChainHeader?: string;
  territory?: string[];
  found: boolean;
}

export class GnsEntraIdentityResolver {
  private gnsApiUrl: string;
  private cache = new Map<string, { record: GnsIdentityRecord; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(gnsApiUrl = 'https://api.gns.foundation', cacheTtlMs = 60_000) {
    this.gnsApiUrl = gnsApiUrl;
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Resolve GNS identity from an Entra user object.
   *
   * Resolution order:
   *   1. Entra user attribute gns_pk (set via Entra user profile sync)
   *   2. userPrincipalName / mail → GNS handle lookup
   *   3. Entra object ID → GNS linked account lookup
   */
  async resolve(user: EntraUser, existingGnsPk?: string): Promise<GnsIdentityRecord> {
    const cacheKey = existingGnsPk ?? user.mail ?? user.userPrincipalName ?? user.id;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.record;

    let record: GnsIdentityRecord;

    if (existingGnsPk) {
      record = await this._fetchByPk(existingGnsPk);
    } else if (user.mail || user.userPrincipalName) {
      record = await this._fetchByEmail(user.mail ?? user.userPrincipalName!);
    } else {
      record = await this._fetchByEntraId(user.id);
    }

    this.cache.set(cacheKey, { record, expiresAt: Date.now() + this.cacheTtlMs });
    return record;
  }

  private async _fetchByPk(pk: string): Promise<GnsIdentityRecord> {
    try {
      // Production: GET https://api.gns.foundation/v1/identity/{pk}
      // const res = await fetch(`${this.gnsApiUrl}/v1/identity/${pk}`);
      // return this._mapApiResponse(await res.json());

      // Simulation:
      return {
        publicKeyHex: pk,
        handle: null,
        trustScore: 72,
        breadcrumbCount: 340,
        humanityProofValid: true,
        lastBreadcrumbAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
        subjectType: 'human',
        territory: ['871e8052affffff', '871e8053affffff', '871e8054affffff'],
        found: true,
      };
    } catch { return this._unknown(pk); }
  }

  private async _fetchByEmail(email: string): Promise<GnsIdentityRecord> {
    try {
      // Production: GET https://api.gns.foundation/v1/lookup/email/{email}
      return this._unknown(email);
    } catch { return this._unknown(email); }
  }

  private async _fetchByEntraId(entraId: string): Promise<GnsIdentityRecord> {
    try {
      // Production: GET https://api.gns.foundation/v1/lookup/entra/{entraId}
      return this._unknown(entraId);
    } catch { return this._unknown(entraId); }
  }

  private _unknown(id: string): GnsIdentityRecord {
    return {
      publicKeyHex: id,
      handle: null,
      trustScore: 0,
      breadcrumbCount: 0,
      humanityProofValid: false,
      lastBreadcrumbAt: null,
      subjectType: 'human',
      found: false,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEARER TOKEN VALIDATOR
// Validates the JWT Entra sends to our endpoint
// ─────────────────────────────────────────────────────────────────────────────

export class EntraBearerValidator {
  private tenantId: string;
  private gnsAppId: string;
  private skip: boolean;

  constructor(tenantId: string, gnsAppId: string, skip = false) {
    this.tenantId = tenantId;
    this.gnsAppId = gnsAppId;
    this.skip = skip;
  }

  /**
   * Validate bearer JWT sent by Entra.
   *
   * Entra sends a JWT with:
   *   iss: https://login.microsoftonline.com/{tenantId}/v2.0
   *   aud: api://gns-claims-provider (our App ID URI)
   *   appid: the Entra authentication events service app ID
   *
   * In production: fetch JWKS from Entra OIDC discovery doc and verify RS256 sig.
   * Here we validate the structure and decode the payload.
   */
  async validate(authHeader: string | undefined): Promise<{
    valid: boolean;
    tenantId?: string;
    reason?: string;
  }> {
    if (this.skip) return { valid: true, tenantId: this.tenantId };

    if (!authHeader?.startsWith('Bearer ')) {
      return { valid: false, reason: 'Missing Bearer token' };
    }

    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, reason: 'Malformed JWT' };

    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8')
      );

      // Validate issuer
      const expectedIss = `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
      if (payload.iss !== expectedIss) {
        return { valid: false, reason: `Issuer mismatch: ${payload.iss}` };
      }

      // Validate audience
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.some((a: string) => a === this.gnsAppId || a === `api://gns-claims-provider`)) {
        return { valid: false, reason: `Audience mismatch: ${payload.aud}` };
      }

      // Validate expiry
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, reason: 'Token expired' };
      }

      // Production: also verify RS256 signature against Entra JWKS
      // const jwks = await fetch(`https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`);
      // verifySignature(token, jwks, payload.kid);

      return { valid: true, tenantId: payload.tid };
    } catch (err) {
      return { valid: false, reason: `JWT decode error: ${(err as Error).message}` };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE HANDLER
// Processes one TokenIssuanceStart event → returns Entra-format response
// ─────────────────────────────────────────────────────────────────────────────

export class GnsEntraClaimsHandler {
  private resolver: GnsEntraIdentityResolver;
  private validator: EntraBearerValidator;
  private config: Required<EntraClaimsConfig>;
  private tierOrder: GnsTrustTier[] = ['SEEDLING', 'EXPLORER', 'NAVIGATOR', 'TRAILBLAZER'];

  constructor(config: EntraClaimsConfig) {
    this.config = {
      gnsAppId: config.gnsAppId,
      tenantId: config.tenantId,
      gnsApiUrl: config.gnsApiUrl ?? 'https://api.gns.foundation',
      cacheTtlMs: config.cacheTtlMs ?? 60_000,
      minTrustTier: config.minTrustTier ?? 'SEEDLING',
      includeTerritory: config.includeTerritory ?? true,
      includeAgentChain: config.includeAgentChain ?? true,
      skipTokenValidation: config.skipTokenValidation ?? false,
      logger: config.logger ?? console,
    };
    this.resolver = new GnsEntraIdentityResolver(this.config.gnsApiUrl, this.config.cacheTtlMs);
    this.validator = new EntraBearerValidator(
      this.config.tenantId,
      this.config.gnsAppId,
      this.config.skipTokenValidation,
    );
  }

  /**
   * Validate bearer token and process the TokenIssuanceStart event.
   */
  async handleRequest(
    authHeader: string | undefined,
    body: EntraTokenIssuanceStartRequest,
  ): Promise<{ status: number; body: EntraTokenIssuanceStartResponse | { error: string } }> {
    const { logger } = this.config;

    // 1. Validate bearer token
    const tokenCheck = await this.validator.validate(authHeader);
    if (!tokenCheck.valid) {
      logger.warn(`[GNS Entra] Auth failed: ${tokenCheck.reason}`);
      return { status: 401, body: { error: tokenCheck.reason ?? 'Unauthorized' } };
    }

    // 2. Validate event type
    if (body.type !== 'microsoft.graph.authenticationEvent.tokenIssuanceStart') {
      return { status: 400, body: { error: `Unexpected event type: ${body.type}` } };
    }

    const { user } = body.data.authenticationContext;
    logger.info(`[GNS Entra] TokenIssuanceStart for user: ${user.userPrincipalName ?? user.id}`);

    // 3. Resolve GNS identity
    const identity = await this.resolver.resolve(user);

    // 4. Build claims (all strings — Entra constraint)
    const claims = this._buildClaims(identity);

    logger.info(`[GNS Entra] Enriched token: tier=${claims.gns_trust_tier}, bc=${claims.gns_breadcrumb_count}, found=${identity.found}`);

    return {
      status: 200,
      body: this._buildResponse(claims),
    };
  }

  /**
   * Build Entra-compatible GNS claims.
   * CRITICAL: All values must be string or string[].
   * Booleans and numbers must be serialized as strings.
   */
  private _buildClaims(identity: GnsIdentityRecord): Record<string, string | string[]> {
    const tier: GnsTrustTier = identity.trustScore >= 75 ? 'TRAILBLAZER'
      : identity.trustScore >= 50 ? 'NAVIGATOR'
      : identity.trustScore >= 25 ? 'EXPLORER' : 'SEEDLING';

    // Check minimum trust tier
    const subTierIdx = this.tierOrder.indexOf(tier);
    const minTierIdx = this.tierOrder.indexOf(this.config.minTrustTier);
    const belowMinTier = subTierIdx < minTierIdx;

    const claims: Record<string, string | string[]> = {
      // Core identity — always present
      gns_pk: identity.publicKeyHex,
      gns_subject_type: identity.subjectType,
      gns_protocol_version: '2.0',
      // Trust signals — degraded if below min tier or not found
      gns_trust_tier: belowMinTier ? 'SEEDLING' : tier,
      gns_trust_score: belowMinTier ? '0' : String(identity.trustScore),
      gns_breadcrumb_count: belowMinTier ? '0' : String(identity.breadcrumbCount),
      gns_humanity_proof_valid: (!belowMinTier && identity.humanityProofValid) ? 'true' : 'false',
      gns_handle: identity.handle ?? '',
      gns_last_seen: identity.lastBreadcrumbAt ?? '',
      gns_identity_found: identity.found ? 'true' : 'false',
    };

    // Territory — string array (Entra supports string[])
    if (this.config.includeTerritory && identity.territory && identity.territory.length > 0) {
      claims['gns_territory'] = identity.territory.slice(0, 10); // cap at 10 to stay under 3KB
    }

    // Agent-specific claims
    if (identity.subjectType === 'ai_agent') {
      if (identity.agentId) claims['gns_agent_id'] = identity.agentId;
      if (this.config.includeAgentChain && identity.delegationChainHeader) {
        claims['gns_delegation_chain'] = identity.delegationChainHeader;
      }
    }

    return claims;
  }

  /** Build the Entra-format response envelope */
  private _buildResponse(claims: Record<string, string | string[]>): EntraTokenIssuanceStartResponse {
    return {
      data: {
        '@odata.type': 'microsoft.graph.onTokenIssuanceStartResponseData',
        actions: [{
          '@odata.type': 'microsoft.graph.tokenIssuanceStart.provideClaimsForToken',
          claims,
        }],
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAIMS MAPPING POLICY GENERATOR
// Generates the JSON you upload to Entra via Graph API
// ─────────────────────────────────────────────────────────────────────────────

export class GnsEntraClaimsMappingPolicy {
  /**
   * Generate the claimsMappingPolicy JSON for Entra.
   *
   * Upload with:
   *   POST https://graph.microsoft.com/v1.0/policies/claimsMappingPolicies
   *   Content-Type: application/json
   *   Authorization: Bearer <graph-token>
   *   { displayName: "GNS Claims Policy", definition: [<stringified>] }
   *
   * Or use GnsEntraAdminClient.uploadClaimsMappingPolicy()
   */
  static generate(options: {
    includeTerritory?: boolean;
    includeAgentClaims?: boolean;
  } = {}): object {
    const schema = [
      { Source: 'CustomClaimsProvider', ID: 'gns_pk',                   JwtClaimType: 'gns_pk' },
      { Source: 'CustomClaimsProvider', ID: 'gns_handle',               JwtClaimType: 'gns_handle' },
      { Source: 'CustomClaimsProvider', ID: 'gns_trust_tier',           JwtClaimType: 'gns_trust_tier' },
      { Source: 'CustomClaimsProvider', ID: 'gns_trust_score',          JwtClaimType: 'gns_trust_score' },
      { Source: 'CustomClaimsProvider', ID: 'gns_breadcrumb_count',     JwtClaimType: 'gns_breadcrumb_count' },
      { Source: 'CustomClaimsProvider', ID: 'gns_humanity_proof_valid', JwtClaimType: 'gns_humanity_proof_valid' },
      { Source: 'CustomClaimsProvider', ID: 'gns_subject_type',         JwtClaimType: 'gns_subject_type' },
      { Source: 'CustomClaimsProvider', ID: 'gns_protocol_version',     JwtClaimType: 'gns_protocol_version' },
      { Source: 'CustomClaimsProvider', ID: 'gns_last_seen',            JwtClaimType: 'gns_last_seen' },
      { Source: 'CustomClaimsProvider', ID: 'gns_identity_found',       JwtClaimType: 'gns_identity_found' },
    ];

    if (options.includeTerritory !== false) {
      schema.push({ Source: 'CustomClaimsProvider', ID: 'gns_territory', JwtClaimType: 'gns_territory' });
    }
    if (options.includeAgentClaims !== false) {
      schema.push({ Source: 'CustomClaimsProvider', ID: 'gns_agent_id',         JwtClaimType: 'gns_agent_id' });
      schema.push({ Source: 'CustomClaimsProvider', ID: 'gns_delegation_chain', JwtClaimType: 'gns_delegation_chain' });
    }

    return {
      ClaimsMappingPolicy: {
        Version: 1,
        IncludeBasicClaimSet: 'true',
        ClaimsSchema: schema,
      },
    };
  }

  /**
   * Generate the Graph API request body to create the policy.
   * The definition must be a stringified + escaped JSON string (Microsoft quirk).
   */
  static generateGraphApiBody(options: Parameters<typeof GnsEntraClaimsMappingPolicy.generate>[0] = {}): object {
    const policy = GnsEntraClaimsMappingPolicy.generate(options);
    return {
      displayName: 'GNS Protocol Claims Mapping Policy',
      definition: [JSON.stringify(policy)],
      isOrganizationDefault: false,
    };
  }

  /**
   * Generate the full setup instructions as a string.
   * Print this for a developer integrating GNS into their Entra tenant.
   */
  static generateSetupGuide(tenantId: string, hookUrl: string): string {
    const policyBody = JSON.stringify(GnsEntraClaimsMappingPolicy.generateGraphApiBody(), null, 2);
    return `
# GNS Protocol × Microsoft Entra ID — Setup Guide

## Step 1: Register GNS App in Entra

1. Azure Portal → Entra ID → App Registrations → New Registration
   - Name: GNS Claims Provider
   - Redirect URI: (none needed)
2. Expose an API:
   - App ID URI: api://gns-claims-provider
   - Add scope: CustomAuthenticationExtension.Receive.Payload
3. Note the App ID (client_id) — you'll need it in Step 2

## Step 2: Create Custom Authentication Extension

1. Entra ID → Enterprise Applications → Custom authentication extensions
2. Create a custom extension:
   - Event type: TokenIssuanceStart
   - Name: GNS Protocol Claims Provider
   - Target URL: ${hookUrl}/claims
   - App registration: select GNS Claims Provider from Step 1
3. Grant admin consent when prompted

## Step 3: Upload Claims Mapping Policy

POST https://graph.microsoft.com/v1.0/policies/claimsMappingPolicies
Authorization: Bearer <token with Policy.ReadWrite.ApplicationConfiguration>
Content-Type: application/json

${policyBody}

## Step 4: Assign to Your Application

1. Enterprise Apps → Your Application → Single sign-on
2. Attributes & Claims → Edit → Advanced settings
3. Custom claims provider → select GNS Protocol Claims Provider
4. Add each gns_* claim from the mapping policy

## Step 5: Test

GET https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize
  ?client_id=<your-app-client-id>
  &response_type=id_token
  &scope=openid profile
  &redirect_uri=https://jwt.ms
  &nonce=test

Decoded token should contain gns_trust_tier, gns_humanity_proof_valid, etc.
`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRA ADMIN CLIENT
// Graph API client — programmatic setup of GNS claims provider
// ─────────────────────────────────────────────────────────────────────────────

export class GnsEntraAdminClient {
  private config: EntraAdminConfig;
  private graphUrl = 'https://graph.microsoft.com/v1.0';

  constructor(config: EntraAdminConfig) {
    this.config = config;
  }

  /** Get a Graph API access token via client credentials */
  async getGraphToken(): Promise<string> {
    // Production:
    // const res = await fetch(
    //   `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
    //   {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //     body: new URLSearchParams({
    //       client_id: this.config.clientId,
    //       client_secret: this.config.clientSecret,
    //       scope: 'https://graph.microsoft.com/.default',
    //       grant_type: 'client_credentials',
    //     }),
    //   }
    // );
    // const { access_token } = await res.json();
    // return access_token;
    return 'simulated-graph-token';
  }

  /**
   * Upload the GNS claimsMappingPolicy to the tenant.
   * Returns the policy ID — needed for assigning to apps.
   */
  async uploadClaimsMappingPolicy(options: Parameters<typeof GnsEntraClaimsMappingPolicy.generate>[0] = {}): Promise<string> {
    const body = GnsEntraClaimsMappingPolicy.generateGraphApiBody(options);
    const token = await this.getGraphToken();

    // Production:
    // const res = await fetch(`${this.graphUrl}/policies/claimsMappingPolicies`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${token}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(body),
    // });
    // const data = await res.json();
    // return data.id;

    // Simulation:
    return `gns-claims-policy-${Date.now()}`;
  }

  /**
   * Register GNS as a Custom Authentication Extension in the tenant.
   * Returns the extension ID.
   */
  async registerCustomExtension(options: EntraProviderInstallOptions): Promise<string> {
    const extensionBody = {
      '@odata.type': '#microsoft.graph.onTokenIssuanceStartCustomExtension',
      displayName: options.name ?? 'GNS Protocol Claims Provider',
      description: 'Enriches tokens with GNS Proof-of-Trajectory humanity proof and trust signals',
      endpointConfiguration: {
        '@odata.type': '#microsoft.graph.httpRequestEndpoint',
        targetUrl: `${options.hookUrl}/claims`,
      },
      authenticationConfiguration: {
        '@odata.type': '#microsoft.graph.azureAdTokenAuthentication',
        resourceId: `api://${options.appId}`,
      },
      claimsForTokenConfiguration: [
        { claimIdInApiResponse: 'gns_pk' },
        { claimIdInApiResponse: 'gns_handle' },
        { claimIdInApiResponse: 'gns_trust_tier' },
        { claimIdInApiResponse: 'gns_trust_score' },
        { claimIdInApiResponse: 'gns_breadcrumb_count' },
        { claimIdInApiResponse: 'gns_humanity_proof_valid' },
        { claimIdInApiResponse: 'gns_subject_type' },
        { claimIdInApiResponse: 'gns_protocol_version' },
        { claimIdInApiResponse: 'gns_last_seen' },
        { claimIdInApiResponse: 'gns_identity_found' },
        { claimIdInApiResponse: 'gns_territory' },
        { claimIdInApiResponse: 'gns_agent_id' },
        { claimIdInApiResponse: 'gns_delegation_chain' },
      ],
    };

    // Production:
    // const res = await fetch(`${this.graphUrl}/identity/customAuthenticationExtensions`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${await this.getGraphToken()}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify(extensionBody),
    // });
    // return (await res.json()).id;

    return `gns-ext-${Date.now()}`;
  }

  /**
   * Assign the GNS claims provider to a specific application.
   */
  async assignToApplication(servicePrincipalId: string, policyId: string): Promise<void> {
    // Production:
    // await fetch(`${this.graphUrl}/servicePrincipals/${servicePrincipalId}/claimsMappingPolicies/$ref`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${await this.getGraphToken()}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ '@odata.id': `${this.graphUrl}/policies/claimsMappingPolicies/${policyId}` }),
    // });
  }

  /**
   * Full one-shot setup: upload policy + register extension + assign to app.
   */
  async setupGnsClaimsProvider(options: EntraProviderInstallOptions & {
    servicePrincipalIds?: string[];
    includeTerritory?: boolean;
    includeAgentClaims?: boolean;
  }): Promise<{ policyId: string; extensionId: string }> {
    const policyId = await this.uploadClaimsMappingPolicy({
      includeTerritory: options.includeTerritory,
      includeAgentClaims: options.includeAgentClaims,
    });

    const extensionId = await this.registerCustomExtension(options);

    for (const spId of (options.servicePrincipalIds ?? [])) {
      await this.assignToApplication(spId, policyId);
    }

    return { policyId, extensionId };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a router-like object for the GNS Entra claims endpoint.
 *
 * Endpoints:
 *   POST /claims      — Entra calls this on TokenIssuanceStart
 *   GET  /health      — Health check
 *   GET  /policy      — Returns claimsMappingPolicy JSON (for setup)
 *   GET  /setup-guide — Returns setup instructions
 */
export function createEntraClaimsRouter(config: EntraClaimsConfig) {
  const handler = new GnsEntraClaimsHandler(config);

  return {
    handler,
    async processRequest(req: {
      method: string;
      path: string;
      headers: Record<string, string | undefined>;
      body: unknown;
    }): Promise<{ status: number; body: unknown }> {

      if (req.method === 'GET' && req.path === '/health') {
        return { status: 200, body: { status: 'ok', service: 'gns-entra-claims', version: '0.1.0' } };
      }

      if (req.method === 'GET' && req.path === '/policy') {
        return { status: 200, body: GnsEntraClaimsMappingPolicy.generateGraphApiBody() };
      }

      if (req.method === 'GET' && req.path === '/setup-guide') {
        return {
          status: 200,
          body: { guide: GnsEntraClaimsMappingPolicy.generateSetupGuide(config.tenantId, 'https://api.gns.foundation/entra') },
        };
      }

      if (req.method === 'POST' && req.path === '/claims') {
        return handler.handleRequest(req.headers['authorization'], req.body as EntraTokenIssuanceStartRequest);
      }

      return { status: 404, body: { error: 'Not found' } };
    },
  };
}

export { GnsOidcProvider };
export type { GnsClaims, GnsTrustTier };
