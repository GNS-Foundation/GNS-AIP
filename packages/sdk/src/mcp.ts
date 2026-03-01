// =============================================================================
// GNS-AIP SDK — MCP (Model Context Protocol) Middleware
// =============================================================================
// Anthropic's MCP is the emerging standard for how AI agents connect to
// data sources and tools. This middleware enables any MCP server to
// automatically enforce GNS-AIP compliance:
//
// Without GNS-AIP:
//   Agent → MCP Server → Database (no identity, no audit, no jurisdiction check)
//
// With GNS-AIP Middleware:
//   Agent → GNS-AIP Middleware → MCP Server → Database
//     ↓
//     1. Parse GNS-AIP-Delegation header from request context
//     2. Verify delegation certificate signature
//     3. Check agent's compliance tier meets minimum for this server
//     4. Verify operation is within agent's territorial scope
//     5. Create virtual breadcrumb for audit trail
//     6. If all pass → forward to MCP server handler
//     7. If any fail → reject with structured error
//
// Integration pattern (3 lines for MCP server developers):
//
//   import { createMCPMiddleware } from '@gns-aip/sdk';
//
//   const gnsMiddleware = createMCPMiddleware({
//     minimumTier: 'trusted',
//     requiredFacet: 'health',
//     serverTerritoryCells: ['871e8052affffff'],
//   });
//
//   // In your MCP tool handler:
//   const result = await gnsMiddleware.guard(requestContext, async () => {
//     return await myToolHandler(args);
//   });
//
// =============================================================================

import { ComplianceTier, DelegationCert, AGENT_FACETS } from './types';
import {
  verifyDelegationCert,
  isDelegationActive,
  isDelegationAuthorizedForCell,
  isDelegationAuthorizedForFacet,
  parseDelegationHeader,
} from './delegation';
import { verify } from './crypto';
import { isTierSufficientForFacet } from './compliance';

// =============================================================================
// MCP Middleware Configuration
// =============================================================================

/**
 * Configuration for the GNS-AIP MCP middleware.
 *
 * MCP server operators define WHAT they require. The middleware
 * enforces it cryptographically.
 */
export interface MCPMiddlewareConfig {
  /** Minimum compliance tier required to access this MCP server */
  minimumTier: ComplianceTier;
  /** Required facet (null = any facet accepted) */
  requiredFacet: string | null;
  /** H3 cells where this MCP server's data is jurisdictionally located */
  serverTerritoryCells: string[];
  /** Whether to verify the request signature (recommended: true) */
  verifyRequestSignature: boolean;
  /** Maximum allowed request timestamp age in seconds (anti-replay) */
  maxTimestampAgeSeconds: number;
  /** Callback to look up a DelegationCert by certHash (from your DB/cache) */
  certLookup: (certHash: string) => Promise<DelegationCert | null>;
  /** Callback to look up an agent's current compliance tier */
  tierLookup: (agentIdentity: string) => Promise<ComplianceTier | null>;
  /** Optional: callback when a request is authorized (for logging/metrics) */
  onAuthorized?: (event: MCPAuthEvent) => void;
  /** Optional: callback when a request is rejected (for logging/alerting) */
  onRejected?: (event: MCPRejectEvent) => void;
}

// =============================================================================
// MCP Middleware
// =============================================================================

/**
 * GNS-AIP middleware for MCP servers.
 *
 * Wraps any MCP tool handler with cryptographic identity verification,
 * jurisdiction checking, and compliance gating.
 */
export class MCPMiddleware {
  private config: MCPMiddlewareConfig;

  constructor(config: MCPMiddlewareConfig) {
    this.config = config;
  }

  /**
   * Guard an MCP tool invocation with GNS-AIP verification.
   *
   * @param context - The MCP request context containing the delegation header
   * @param handler - The actual MCP tool handler to call if authorized
   * @returns The handler result, or throws MCPGateError on rejection
   */
  async guard<T>(
    context: MCPRequestContext,
    handler: () => Promise<T>
  ): Promise<T> {
    // ── 1. Extract delegation header ──
    const headerValue = context.delegationHeader;
    if (!headerValue) {
      return this.reject('missing_header', 'Request missing GNS-AIP-Delegation header');
    }

    const parsed = parseDelegationHeader(headerValue);
    if (!parsed) {
      return this.reject('invalid_header', 'GNS-AIP-Delegation header is malformed');
    }

    // ── 2. Anti-replay: check timestamp freshness ──
    const requestAge = (Date.now() - new Date(parsed.timestamp).getTime()) / 1000;
    if (requestAge > this.config.maxTimestampAgeSeconds) {
      return this.reject(
        'stale_request',
        `Request timestamp is ${requestAge.toFixed(0)}s old (max: ${this.config.maxTimestampAgeSeconds}s)`
      );
    }
    if (requestAge < -30) {
      return this.reject('future_request', 'Request timestamp is in the future');
    }

    // ── 3. Look up the delegation certificate ──
    const cert = await this.config.certLookup(parsed.certHash);
    if (!cert) {
      return this.reject(
        'unknown_cert',
        `Delegation certificate ${parsed.certHash.substring(0, 16)}... not found`
      );
    }

    // ── 4. Verify the cert signature ──
    if (!verifyDelegationCert(cert)) {
      return this.reject('invalid_cert_signature', 'Delegation certificate signature verification failed');
    }

    // ── 5. Verify cert is active ──
    if (!isDelegationActive(cert)) {
      return this.reject('expired_cert', `Delegation certificate expired at ${cert.validUntil}`);
    }

    // ── 6. Verify agent identity matches ──
    if (cert.agentIdentity !== parsed.agentIdentity) {
      return this.reject(
        'identity_mismatch',
        'Agent identity in header does not match delegation certificate'
      );
    }

    // ── 7. Verify request signature (agent signed the request) ──
    if (this.config.verifyRequestSignature) {
      const dataToVerify = `${cert.certHash}:${parsed.timestamp}:${context.requestData || ''}`;
      const sigValid = verify(parsed.agentIdentity, dataToVerify, parsed.requestSignature);
      if (!sigValid) {
        return this.reject('invalid_request_signature', 'Agent request signature verification failed');
      }
    }

    // ── 8. Verify facet permission ──
    if (this.config.requiredFacet) {
      if (!isDelegationAuthorizedForFacet(cert, this.config.requiredFacet)) {
        return this.reject(
          'facet_denied',
          `Agent not authorized for facet '${this.config.requiredFacet}' (has: ${cert.facetPermissions.join(', ')})`
        );
      }
    }

    // ── 9. Verify territorial jurisdiction ──
    if (this.config.serverTerritoryCells.length > 0) {
      const hasOverlap = this.config.serverTerritoryCells.some(
        cell => isDelegationAuthorizedForCell(cert, cell)
      );
      if (!hasOverlap) {
        return this.reject(
          'jurisdiction_denied',
          'Agent territory does not overlap with this MCP server\'s data jurisdiction'
        );
      }
    }

    // ── 10. Verify compliance tier ──
    const agentTier = await this.config.tierLookup(parsed.agentIdentity);
    if (!agentTier) {
      return this.reject(
        'unknown_agent',
        `Agent ${parsed.agentIdentity.substring(0, 16)}... has no compliance record`
      );
    }

    if (!isTierSufficientForFacet(agentTier, this.config.minimumTier)) {
      return this.reject(
        'insufficient_tier',
        `Agent tier '${agentTier}' does not meet minimum '${this.config.minimumTier}' for this server`
      );
    }

    // ── All checks passed — execute handler ──
    this.config.onAuthorized?.({
      agentIdentity: parsed.agentIdentity,
      certHash: parsed.certHash,
      tier: agentTier,
      facet: this.config.requiredFacet,
      timestamp: parsed.timestamp,
    });

    return handler();
  }

  /**
   * Lightweight check (no handler execution) — useful for preflight/health checks.
   */
  async verify(context: MCPRequestContext): Promise<MCPVerifyResult> {
    try {
      await this.guard(context, async () => null);
      return { authorized: true };
    } catch (err) {
      if (err instanceof MCPGateError) {
        return { authorized: false, reason: err.code, message: err.message };
      }
      return { authorized: false, reason: 'internal_error', message: String(err) };
    }
  }

  private reject(code: MCPRejectCode, message: string): never {
    this.config.onRejected?.({ code, message, timestamp: new Date().toISOString() });
    throw new MCPGateError(code, message);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a GNS-AIP middleware for an MCP server.
 *
 * @example
 * ```typescript
 * const middleware = createMCPMiddleware({
 *   minimumTier: 'trusted',
 *   requiredFacet: 'health',
 *   serverTerritoryCells: ['871e8052affffff'],
 *   certLookup: async (hash) => db.delegations.findByHash(hash),
 *   tierLookup: async (identity) => db.agents.getTier(identity),
 * });
 * ```
 */
export function createMCPMiddleware(
  config: Partial<MCPMiddlewareConfig> & {
    certLookup: MCPMiddlewareConfig['certLookup'];
    tierLookup: MCPMiddlewareConfig['tierLookup'];
  }
): MCPMiddleware {
  const fullConfig: MCPMiddlewareConfig = {
    minimumTier: config.minimumTier || 'observed',
    requiredFacet: config.requiredFacet || null,
    serverTerritoryCells: config.serverTerritoryCells || [],
    verifyRequestSignature: config.verifyRequestSignature ?? true,
    maxTimestampAgeSeconds: config.maxTimestampAgeSeconds ?? 300, // 5 minutes
    certLookup: config.certLookup,
    tierLookup: config.tierLookup,
    onAuthorized: config.onAuthorized,
    onRejected: config.onRejected,
  };

  return new MCPMiddleware(fullConfig);
}

// =============================================================================
// Types
// =============================================================================

/**
 * The MCP request context that the middleware needs to inspect.
 * MCP server implementers extract this from their transport layer.
 */
export interface MCPRequestContext {
  /** Base64-encoded GNS-AIP-Delegation header value */
  delegationHeader: string | null;
  /** Optional: request data string used for signature verification */
  requestData?: string;
  /** Optional: the MCP tool name being invoked */
  toolName?: string;
}

export type MCPRejectCode =
  | 'missing_header'
  | 'invalid_header'
  | 'stale_request'
  | 'future_request'
  | 'unknown_cert'
  | 'invalid_cert_signature'
  | 'expired_cert'
  | 'identity_mismatch'
  | 'invalid_request_signature'
  | 'facet_denied'
  | 'jurisdiction_denied'
  | 'unknown_agent'
  | 'insufficient_tier'
  | 'internal_error';

export class MCPGateError extends Error {
  code: MCPRejectCode;

  constructor(code: MCPRejectCode, message: string) {
    super(message);
    this.name = 'MCPGateError';
    this.code = code;
  }
}

export interface MCPAuthEvent {
  agentIdentity: string;
  certHash: string;
  tier: ComplianceTier;
  facet: string | null;
  timestamp: string;
}

export interface MCPRejectEvent {
  code: MCPRejectCode;
  message: string;
  timestamp: string;
}

export interface MCPVerifyResult {
  authorized: boolean;
  reason?: string;
  message?: string;
}
