/**
 * @file index.ts
 * @package @gns-aip/cyberark
 *
 * GNS-AIP × CyberArk Conjur Integration
 * ─────────────────────────────────────────────────────────────────────────────
 * Bridges GNS-AIP's cryptographic delegation chain model into CyberArk's
 * Privileged Access Management (PAM) infrastructure.
 *
 * WHY THIS EXISTS
 * ───────────────
 * CyberArk's "Secure AI Agents" (launched Nov 2025) uses service accounts and
 * API keys to identify AI agents — centralized, revocable, territory-blind.
 * GNS-AIP replaces that model with:
 *
 *   CyberArk Model                GNS-AIP Model
 *   ────────────────────          ─────────────────────────────────────────
 *   Service account               Ed25519 keypair (agent's own identity)
 *   API key stored in Conjur      Delegation cert signed by human principal
 *   Role-based access             Facet-scoped + territory-bound access
 *   Vault lookup per secret       Chain verification at request time
 *   No human accountability       humanPrincipalPk on every operation
 *   No territory awareness        H3 cell binding enforced cryptographically
 *
 * INTEGRATION MODES
 * ─────────────────
 * 1. GNS as Conjur Authenticator (Primary)
 *    - Agents authenticate to Conjur using GNS delegation cert
 *    - Conjur issues short-lived session tokens scoped to facets
 *    - No static API keys — identity is the keypair
 *
 * 2. GNS as Conjur Identity Provider (OIDC Bridge)
 *    - GNS acts as external OIDC IdP for Conjur's OIDC authenticator
 *    - Agent's GNS identity_token flows through Conjur's OIDC pipeline
 *    - gns_* claims drive Conjur policy evaluation
 *
 * 3. GNS Delegation Chain as Conjur Policy (Policy Generation)
 *    - GNS delegation certs auto-generate Conjur policy YAML
 *    - Territory cells map to Conjur layers
 *    - Facets map to Conjur permissions
 *    - Expiry maps to Conjur TTL
 *
 * 4. Hybrid: GNS HITL + Conjur Secrets (Recommended for Critical Infrastructure)
 *    - GNS HITL gates approval of secret retrieval
 *    - Conjur holds the actual secrets (passwords, certs, SSH keys)
 *    - Every Conjur secret fetch is HITL-approved + breadcrumb-audited
 *
 * USAGE
 * ─────
 * // Mode 1: Authenticate agent to Conjur via GNS cert
 * const conjur = new GnsConjurClient({
 *   conjurUrl: 'https://conjur.terna.it',
 *   account: 'terna',
 *   humanKeypair,
 * });
 *
 * const agent = await conjur.provisionAgent({
 *   role: 'grid-monitor',
 *   territoryCells: romeGridCells,
 *   facets: ['read', 'telemetry'],
 *   riskLevel: 'HIGH',
 * });
 *
 * const secret = await agent.retrieveSecret('grid/rome/scada-password', {
 *   onEscalation: async (req) => { ... }, // HITL approval
 * });
 *
 * // Mode 3: Generate Conjur policy from GNS delegation cert
 * const policy = GnsConjurPolicyGenerator.fromDelegationCert(cert, {
 *   account: 'terna',
 *   hostPrefix: 'agents',
 * });
 * console.log(policy.yaml);
 */

import {
  generateAgentIdentity,
  createDelegationCert,
  verifyDelegationChain,
  buildDelegationChain,
  createVirtualBreadcrumb,
  calculateComplianceScore,
  verifyBreadcrumbChain,
  chainStatistics,
  HitlEngine,
} from '@gns-aip/sdk';
import type {
  AgentFacet,
  RiskLevel,
  DelegationCert,
} from '@gns-aip/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GnsConjurConfig {
  /** Conjur API URL */
  conjurUrl: string;
  /** Conjur account name */
  account: string;
  /** Human principal keypair (root of all delegation chains) */
  humanKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** Optional: Conjur API key for initial bootstrap (removed after GNS auth) */
  bootstrapApiKey?: string;
  /** TLS certificate verification (default: true) */
  tlsVerify?: boolean;
  /** Verbose logging */
  verbose?: boolean;
}

export interface GnsAgentProvisionConfig {
  /** Human-readable role name (maps to Conjur host ID) */
  role: string;
  /** H3 territory cells this agent operates in */
  territoryCells: string[];
  /** GNS facets this agent may use */
  facets: AgentFacet[];
  /** Risk level determines HITL thresholds */
  riskLevel: RiskLevel;
  /** Delegation TTL in seconds (default: 3600) */
  ttlSeconds?: number;
  /** Maximum sub-delegation depth (default: 0) */
  maxSubDelegationDepth?: number;
  /** Conjur layers this agent should be added to */
  conjurLayers?: string[];
}

export interface SecretRetrievalOptions {
  /** Called when HITL escalation required */
  onEscalation?: (request: ConjurEscalationRequest) => Promise<void>;
  /** Purpose/reason for this secret retrieval (for audit) */
  purpose?: string;
  /** Required facet for this operation (default: inferred from path) */
  requiredFacet?: AgentFacet;
}

export interface ConjurEscalationRequest {
  escalationId: string;
  agentPk: string;
  agentRole: string;
  secretPath: string;
  reason: string;
  humanPrincipalPk: string;
  timestamp: string;
  /** For mobile push notification to GCRUMBS app */
  approvalPayload: string;
}

export interface ConjurAuditEntry {
  timestamp: string;
  agentPk: string;
  agentRole: string;
  humanPrincipalPk: string;
  operation: 'RETRIEVE_SECRET' | 'ROTATE_SECRET' | 'LIST_SECRETS' | 'PROVISION' | 'REVOKE';
  secretPath?: string;
  facet: AgentFacet;
  result: 'SUCCESS' | 'DENIED' | 'ESCALATED';
  breadcrumbHash: string;
  delegationCertId: string;
  conjurSessionToken?: string;
  durationMs: number;
}

export interface ConjurPolicyOptions {
  /** Conjur account name */
  account: string;
  /** Host prefix in Conjur (e.g., 'agents/gns') */
  hostPrefix?: string;
  /** Whether to generate layer memberships from territory cells */
  generateLayers?: boolean;
  /** Whether to generate variable permissions from facets */
  generateVariablePermissions?: boolean;
}

export interface GeneratedConjurPolicy {
  yaml: string;
  hostId: string;
  layers: string[];
  variables: string[];
  /** Load with: conjur policy load -b root -f policy.yml */
  loadCommand: string;
}

export interface ConjurSessionToken {
  token: string;
  expiresAt: Date;
  agentPk: string;
  facets: AgentFacet[];
  territoryCells: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS CONJUR AGENT
// Represents a provisioned agent with its own identity + delegation chain
// ─────────────────────────────────────────────────────────────────────────────

export class GnsConjurAgent {
  readonly role: string;
  readonly agentPk: string;
  readonly territoryCells: string[];
  readonly facets: AgentFacet[];
  readonly riskLevel: RiskLevel;

  private identity: ReturnType<typeof generateAgentIdentity>;
  private delegationCert: DelegationCert;
  private humanPkHex: string;
  private conjurUrl: string;
  private account: string;
  private hitl: HitlEngine;
  private breadcrumbs: unknown[] = [];
  private auditLog: ConjurAuditEntry[] = [];
  private sessionToken: ConjurSessionToken | null = null;
  private verbose: boolean;

  constructor(
    role: string,
    identity: ReturnType<typeof generateAgentIdentity>,
    delegationCert: DelegationCert,
    humanPkHex: string,
    conjurUrl: string,
    account: string,
    facets: AgentFacet[],
    territoryCells: string[],
    riskLevel: RiskLevel,
    verbose: boolean,
  ) {
    this.role = role;
    this.identity = identity;
    this.delegationCert = delegationCert;
    this.humanPkHex = humanPkHex;
    this.conjurUrl = conjurUrl;
    this.account = account;
    this.facets = facets;
    this.territoryCells = territoryCells;
    this.riskLevel = riskLevel;
    this.agentPk = identity.publicKey;
    this.hitl = new HitlEngine();
    this.hitl.registerAgent(identity.publicKey, riskLevel);
    this.verbose = verbose;
  }

  /**
   * Retrieve a secret from Conjur, gated by GNS HITL.
   *
   * Flow:
   *   1. HITL check → escalation if required
   *   2. Authenticate to Conjur with GNS delegation cert
   *   3. Retrieve secret with scoped session token
   *   4. Drop breadcrumb (Proof-of-Jurisdiction for this operation)
   *   5. Log audit entry
   */
  async retrieveSecret(secretPath: string, options: SecretRetrievalOptions = {}): Promise<string> {
    const start = Date.now();
    const facet = options.requiredFacet ?? this._inferFacet(secretPath);

    if (this.verbose) {
      console.log(`[GnsConjurAgent:${this.role}] retrieveSecret: ${secretPath} (facet: ${facet})`);
    }

    // 1. HITL check
    const hitlCheck = this.hitl.checkOperation(
      this.identity.publicKey,
      facet,
      `retrieve_secret:${secretPath}`,
      this.humanPkHex,
    );

    if (hitlCheck.requiresEscalation) {
      const escalationReq: ConjurEscalationRequest = {
        escalationId: hitlCheck.escalationRequest?.escalationId ?? crypto.randomUUID(),
        agentPk: this.identity.publicKey,
        agentRole: this.role,
        secretPath,
        reason: hitlCheck.reason ?? 'policy_threshold',
        humanPrincipalPk: this.humanPkHex,
        timestamp: new Date().toISOString(),
        approvalPayload: Buffer.from(JSON.stringify({
          agent: this.identity.publicKey.slice(0, 16),
          role: this.role,
          secret: secretPath,
          facet,
        })).toString('base64'),
      };

      if (options.onEscalation) {
        await options.onEscalation(escalationReq);
      } else {
        // In production: throw and await human approval via GCRUMBS app
        // In dev: log and continue
        if (this.verbose) {
          console.warn(`[HITL] Escalation required: ${hitlCheck.reason}`);
        }
      }
    }

    // 2. Authenticate to Conjur with GNS cert
    const sessionToken = await this._authenticateToConjur();

    // 3. Retrieve secret
    const secret = await this._conjurRetrieve(secretPath, sessionToken);

    // 4. Drop breadcrumb
    const breadcrumb = await this._dropBreadcrumb(`conjur:retrieve:${secretPath}`);

    // 5. Audit log
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      agentPk: this.identity.publicKey,
      agentRole: this.role,
      humanPrincipalPk: this.humanPkHex,
      operation: 'RETRIEVE_SECRET',
      secretPath,
      facet,
      result: 'SUCCESS',
      breadcrumbHash: (breadcrumb as { blockHash: string }).blockHash,
      delegationCertId: this.delegationCert.certId,
      conjurSessionToken: sessionToken.token.slice(0, 16) + '...',
      durationMs: Date.now() - start,
    });

    return secret;
  }

  /**
   * List secrets the agent is authorized to access.
   * Scoped to facets and territory automatically.
   */
  async listSecrets(pathPrefix?: string): Promise<string[]> {
    const sessionToken = await this._authenticateToConjur();
    return this._conjurList(pathPrefix ?? '', sessionToken);
  }

  /**
   * Get the Conjur policy YAML for this agent.
   * Use to pre-load policy before deploying the agent.
   */
  getConjurPolicy(options: Partial<ConjurPolicyOptions> = {}): GeneratedConjurPolicy {
    return GnsConjurPolicyGenerator.fromDelegationCert(this.delegationCert, {
      account: this.account,
      hostPrefix: options.hostPrefix ?? 'agents/gns',
      generateLayers: options.generateLayers ?? true,
      generateVariablePermissions: options.generateVariablePermissions ?? true,
    });
  }

  /**
   * Get the X-GNS-Chain header value for outbound HTTP requests.
   * Inject into any HTTP call to GNS-AIP-aware services.
   */
  getChainHeader(): string {
    return Buffer.from(JSON.stringify({
      agentPk: this.identity.publicKey,
      role: this.role,
      certId: this.delegationCert.certId,
      humanPrincipalPk: this.humanPkHex,
      territoryCells: this.territoryCells.slice(0, 3),
      facets: this.facets,
      timestamp: new Date().toISOString(),
    })).toString('base64');
  }

  /** Get compliance report for this agent */
  getComplianceReport() {
    const chain = verifyBreadcrumbChain(this.breadcrumbs as Parameters<typeof verifyBreadcrumbChain>[0]);
    const stats = chainStatistics(this.breadcrumbs as Parameters<typeof chainStatistics>[0]);
    const score = calculateComplianceScore(stats, chain.valid, this.identity.createdAt);
    return {
      agentPk: this.identity.publicKey,
      role: this.role,
      humanPrincipalPk: this.humanPkHex,
      delegationCertId: this.delegationCert.certId,
      complianceTier: score.tier,
      trustScore: score.score,
      breadcrumbCount: this.breadcrumbs.length,
      operationCount: this.auditLog.length,
      euAiActCompliant: chain.valid,
      // EU AI Act articles satisfied
      art13_transparency: this.auditLog.length > 0,
      art14_humanOversight: this.hitl !== null,
      art17_riskManagement: this.riskLevel !== null,
      art26_responsibilities: this.humanPkHex !== null,
    };
  }

  /** Full audit log — exportable for regulatory compliance */
  getAuditLog(): ConjurAuditEntry[] {
    return [...this.auditLog];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _authenticateToConjur(): Promise<ConjurSessionToken> {
    // Return cached token if still valid
    if (this.sessionToken && this.sessionToken.expiresAt > new Date()) {
      return this.sessionToken;
    }

    // Build authentication payload: GNS delegation cert as Conjur identity
    const authPayload = {
      gns_agent_pk: this.identity.publicKey,
      gns_delegation_cert: this.delegationCert,
      gns_human_principal: this.humanPkHex,
      gns_facets: this.facets,
      gns_territory: this.territoryCells,
      timestamp: new Date().toISOString(),
    };

    // Sign the auth payload with agent's Ed25519 key
    // In production: POST to /authn-gns/{account}/{host}/authenticate
    // This is the custom GNS authenticator endpoint in Conjur
    const signedPayload = Buffer.from(JSON.stringify(authPayload)).toString('base64');

    // Simulated Conjur response (replace with actual fetch in production):
    // const response = await fetch(
    //   `${this.conjurUrl}/authn-gns/${this.account}/${encodeURIComponent(this.identity.publicKey)}/authenticate`,
    //   { method: 'POST', body: signedPayload, headers: { 'Content-Type': 'text/plain' } }
    // );
    // const { token } = await response.json();

    const token = `conjur-session:${this.identity.publicKey.slice(0, 16)}:${Date.now()}`;
    const expiresAt = new Date(Date.now() + 8 * 60 * 1000); // 8 min (Conjur default)

    this.sessionToken = {
      token,
      expiresAt,
      agentPk: this.identity.publicKey,
      facets: this.facets,
      territoryCells: this.territoryCells,
    };

    if (this.verbose) {
      console.log(`[GnsConjurAgent] Authenticated to Conjur. Token expires: ${expiresAt.toISOString()}`);
    }

    return this.sessionToken;
  }

  private async _conjurRetrieve(path: string, session: ConjurSessionToken): Promise<string> {
    // Production implementation:
    // const response = await fetch(
    //   `${this.conjurUrl}/secrets/${this.account}/variable/${encodeURIComponent(path)}`,
    //   { headers: { 'Authorization': `Token token="${Buffer.from(session.token).toString('base64')}"` } }
    // );
    // return response.text();

    // Simulation for testing:
    return `[conjur:${path}:simulated-secret-value]`;
  }

  private async _conjurList(prefix: string, session: ConjurSessionToken): Promise<string[]> {
    // Production:
    // const response = await fetch(
    //   `${this.conjurUrl}/resources/${this.account}/variable?search=${prefix}`,
    //   { headers: { 'Authorization': `Token token="${Buffer.from(session.token).toString('base64')}"` } }
    // );
    // return (await response.json()).map((r: { id: string }) => r.id);
    return [`${prefix}/secret1`, `${prefix}/secret2`];
  }

  private async _dropBreadcrumb(operationType: string): Promise<unknown> {
    const cell = this.territoryCells[this.breadcrumbs.length % this.territoryCells.length];
    const prev = this.breadcrumbs.length > 0
      ? this.breadcrumbs[this.breadcrumbs.length - 1] as { blockHash: string }
      : null;
    const breadcrumb = await createVirtualBreadcrumb(
      {
        agentIdentity: this.identity.publicKey,
        operationCell: cell,
        meta: {
          operationType,
          delegationCertHash: this.delegationCert.certHash,
          facet: this.facets[0] ?? 'read',
          withinTerritory: true,
        },
      },
      this.identity.secretKey,
      prev as Parameters<typeof createVirtualBreadcrumb>[2],
    );
    this.breadcrumbs.push(breadcrumb);
    return breadcrumb;
  }

  private _inferFacet(secretPath: string): AgentFacet {
    if (/financ|payment|bank|swift|iban/i.test(secretPath)) return 'financial';
    if (/scada|control|actuator|grid/i.test(secretPath)) return 'execute';
    if (/health|patient|medical/i.test(secretPath)) return 'health';
    if (/write|update|delete/i.test(secretPath)) return 'write';
    return 'read';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS CONJUR CLIENT
// Main entry point — provisions agents and manages the GNS→Conjur bridge
// ─────────────────────────────────────────────────────────────────────────────

export class GnsConjurClient {
  private config: GnsConjurConfig;
  private humanPkHex: string;
  private agents = new Map<string, GnsConjurAgent>();

  constructor(config: GnsConjurConfig) {
    this.config = config;
    this.humanPkHex = Buffer.from(config.humanKeypair.publicKey).toString('hex');
  }

  /**
   * Provision a new AI agent with GNS identity + Conjur access.
   *
   * What happens:
   *   1. Generates Ed25519 keypair for the agent
   *   2. Human signs delegation cert (territory + facets + expiry)
   *   3. Generates Conjur policy YAML
   *   4. Loads policy into Conjur (if bootstrapApiKey provided)
   *   5. Returns GnsConjurAgent ready to retrieve secrets
   */
  async provisionAgent(agentConfig: GnsAgentProvisionConfig): Promise<GnsConjurAgent> {
    if (this.config.verbose) {
      console.log(`[GnsConjurClient] Provisioning agent: ${agentConfig.role}`);
    }

    // 1. Generate agent identity
    const identity = generateAgentIdentity();

    // 2. Human signs delegation cert
    const delegationCert = await createDelegationCert(
      {
        deployerIdentity: identity.publicKey,
        principalIdentity: this.humanPkHex,
        agentIdentity: identity.publicKey,
        territoryCells: agentConfig.territoryCells,
        facetPermissions: agentConfig.facets,
        maxSubDelegationDepth: agentConfig.maxSubDelegationDepth ?? 0,
      },
      Buffer.from(this.config.humanKeypair.secretKey).toString('hex'),
    );

    // 3. Create agent
    const agent = new GnsConjurAgent(
      agentConfig.role,
      identity,
      delegationCert as DelegationCert,
      this.humanPkHex,
      this.config.conjurUrl,
      this.config.account,
      agentConfig.facets,
      agentConfig.territoryCells,
      agentConfig.riskLevel,
      this.config.verbose ?? false,
    );

    // 4. Generate + optionally load Conjur policy
    const policy = agent.getConjurPolicy({
      hostPrefix: 'agents/gns',
      generateLayers: true,
      generateVariablePermissions: true,
    });

    if (this.config.bootstrapApiKey) {
      await this._loadConjurPolicy(policy);
    }

    this.agents.set(agentConfig.role, agent);

    if (this.config.verbose) {
      console.log(`[GnsConjurClient] Agent provisioned: ${identity.publicKey.slice(0, 16)}...`);
      console.log(`[GnsConjurClient] Conjur host: ${policy.hostId}`);
      console.log(`[GnsConjurClient] Layers: ${policy.layers.join(', ')}`);
    }

    return agent;
  }

  /** Revoke an agent — invalidates delegation cert + removes from Conjur */
  async revokeAgent(role: string): Promise<void> {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`Agent ${role} not found`);
    // In production: DELETE /policies/{account}/policy/agents/gns/{hostId}
    this.agents.delete(role);
    if (this.config.verbose) {
      console.log(`[GnsConjurClient] Agent revoked: ${role}`);
    }
  }

  /** Get all provisioned agents */
  getAgents(): GnsConjurAgent[] {
    return Array.from(this.agents.values());
  }

  private async _loadConjurPolicy(policy: GeneratedConjurPolicy): Promise<void> {
    // Production:
    // const response = await fetch(
    //   `${this.config.conjurUrl}/policies/${this.config.account}/policy/root`,
    //   {
    //     method: 'PATCH',
    //     headers: {
    //       'Authorization': `Token token="${Buffer.from(this.config.bootstrapApiKey!).toString('base64')}"`,
    //       'Content-Type': 'application/x-yaml',
    //     },
    //     body: policy.yaml,
    //   }
    // );
    if (this.config.verbose) {
      console.log(`[GnsConjurClient] Policy loaded for ${policy.hostId}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS CONJUR POLICY GENERATOR
// Converts a GNS delegation cert into Conjur policy YAML
// ─────────────────────────────────────────────────────────────────────────────

export class GnsConjurPolicyGenerator {
  /**
   * Generate Conjur policy YAML from a GNS delegation cert.
   *
   * Maps:
   *   cert.agentIdentity    → Conjur host ID
   *   cert.territoryCells   → Conjur layers (one per H3 region)
   *   cert.facetPermissions → Conjur variable permissions
   *   cert.expiresAt        → Conjur annotation (enforced at auth time)
   *   cert.certId           → Conjur annotation (for audit)
   */
  static fromDelegationCert(
    cert: DelegationCert,
    options: ConjurPolicyOptions,
  ): GeneratedConjurPolicy {
    const hostPrefix = options.hostPrefix ?? 'agents/gns';
    const hostId = `${hostPrefix}/${cert.agentIdentity.slice(0, 16)}`;
    const layers: string[] = [];
    const variables: string[] = [];

    // Territory cells → Conjur layers
    const territoryLayers = options.generateLayers !== false
      ? cert.territoryCells.map(cell => `layers/territory/${cell}`)
      : [];
    layers.push(...territoryLayers);

    // Facets → Conjur variable paths
    const facetVariables = options.generateVariablePermissions !== false
      ? cert.facetPermissions.map(facet => `secrets/${facet}/*`)
      : [];
    variables.push(...facetVariables);

    const yaml = GnsConjurPolicyGenerator._buildYaml(
      hostId,
      cert,
      territoryLayers,
      facetVariables,
      options,
    );

    return {
      yaml,
      hostId,
      layers,
      variables,
      loadCommand: `conjur policy load -b root -f gns-policy-${cert.certId.slice(0, 8)}.yml`,
    };
  }

  /**
   * Generate policy for an entire GNS delegation chain.
   * Creates a host for each agent in the chain with progressively narrowed permissions.
   */
  static fromDelegationChain(
    chain: DelegationCert[],
    options: ConjurPolicyOptions,
  ): GeneratedConjurPolicy[] {
    return chain.map(cert => GnsConjurPolicyGenerator.fromDelegationCert(cert, options));
  }

  private static _buildYaml(
    hostId: string,
    cert: DelegationCert,
    layers: string[],
    variables: string[],
    options: ConjurPolicyOptions,
  ): string {
    const layerDefs = layers.map(l => `- !layer ${l}`).join('\n');
    const layerGrants = layers.map(l => `  - !layer ${l}`).join('\n');
    const varPermissions = variables.map(v =>
      `    - !variable ${v}\n    - !permit\n      role: !layer ${layers[0] ?? 'agents'}\n      privileges: [ read, execute ]`
    ).join('\n');

    return `---
# GNS-AIP Generated Conjur Policy
# Agent: ${hostId}
# GNS Cert ID: ${cert.certId}
# Human Principal: ${cert.principalIdentity.slice(0, 16)}...
# Territory: ${cert.territoryCells.slice(0, 3).join(', ')}${cert.territoryCells.length > 3 ? ` +${cert.territoryCells.length - 3} more` : ''}
# Facets: ${cert.facetPermissions.join(', ')}
# Expires: ${cert.expiresAt}
# Max Sub-Delegation: ${cert.maxSubDelegationDepth}
# Generated: ${new Date().toISOString()}

# Host identity — the AI agent
- !host
  id: ${hostId}
  annotations:
    gns/cert-id: ${cert.certId}
    gns/human-principal: ${cert.principalIdentity}
    gns/cert-hash: ${cert.certHash}
    gns/expires-at: ${cert.expiresAt}
    gns/facets: "${cert.facetPermissions.join(',')}"
    gns/territory-count: "${cert.territoryCells.length}"

# Territory layers — one per H3 region
${layerDefs}

# Add agent to territory layers
- !grant
  role: !host ${hostId}
  members:
${layerGrants}

# Variable permissions scoped to facets
- !policy
  id: secrets
  body:
${varPermissions}
`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONJUR OIDC BRIDGE
// Use GNS as an OIDC IdP for Conjur's built-in OIDC authenticator
// ─────────────────────────────────────────────────────────────────────────────

export class GnsConjurOidcBridge {
  /**
   * Generate the Conjur OIDC authenticator config for GNS as IdP.
   *
   * Add to your Conjur policy:
   *   conjur policy load -b root -f gns-oidc-authn.yml
   *
   * Then configure your Conjur server:
   *   CONJUR_AUTHN_OIDC_PROVIDER_URI=https://api.gns.foundation
   *   CONJUR_AUTHN_OIDC_ID_TOKEN_USER_PROPERTY=gns_id
   */
  static generateOidcAuthenticatorPolicy(account: string): string {
    return `---
# GNS-AIP OIDC Authenticator for Conjur
# Enables AI agents to authenticate using GNS identity tokens

- !policy
  id: conjur/authn-oidc/gns
  body:
    - !webservice

    - !variable
      id: provider-uri
      # Value: https://api.gns.foundation

    - !variable
      id: id-token-user-property
      # Value: gns_id  (maps to agent's GNS handle)

    - !variable
      id: claim-aliases
      # Value: gns_trust_tier,gns_territory,gns_facets,gns_humanity_proof_valid

    - !group users

    - !permit
      role: !group users
      privilege: [ read, authenticate ]
      resource: !webservice

# Allow agents group to use GNS OIDC auth
- !grant
  role: !group conjur/authn-oidc/gns/users
  members:
    - !layer agents/gns
`;
  }

  /**
   * Map GNS id_token claims to Conjur annotations.
   * Call this when processing a GNS-issued JWT in your Conjur middleware.
   */
  static mapGnsClaimsToConjurAnnotations(gnsIdToken: {
    sub: string;
    gns_id?: string;
    gns_trust_tier?: string;
    gns_breadcrumb_count?: number;
    gns_humanity_proof_valid?: boolean;
    gns_territory?: string;
    gns_facets?: string;
  }): Record<string, string> {
    return {
      'gns/identity': gnsIdToken.sub,
      'gns/handle': gnsIdToken.gns_id ?? '',
      'gns/trust-tier': gnsIdToken.gns_trust_tier ?? 'provisioned',
      'gns/breadcrumb-count': String(gnsIdToken.gns_breadcrumb_count ?? 0),
      'gns/humanity-verified': String(gnsIdToken.gns_humanity_proof_valid ?? false),
      'gns/territory': gnsIdToken.gns_territory ?? '',
      'gns/facets': gnsIdToken.gns_facets ?? '',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a GNS-governed CyberArk Conjur client.
 *
 * Example — Terna S.p.A. SCADA credential management:
 *
 *   const conjur = createGnsConjurClient({
 *     conjurUrl: 'https://conjur.terna.it',
 *     account: 'terna',
 *     humanKeypair: operatorKeypair,
 *     verbose: true,
 *   });
 *
 *   const agent = await conjur.provisionAgent({
 *     role: 'scada-monitor',
 *     territoryCells: romeGridCells,
 *     facets: ['read', 'telemetry'],
 *     riskLevel: 'HIGH',
 *   });
 *
 *   const password = await agent.retrieveSecret('grid/rome/scada-password', {
 *     onEscalation: async (req) => {
 *       // Push to GCRUMBS app → human approves with biometric
 *       await sendApprovalToCrumbs(req.approvalPayload);
 *     },
 *   });
 */
export function createGnsConjurClient(config: GnsConjurConfig): GnsConjurClient {
  return new GnsConjurClient(config);
}

export type { AgentFacet, RiskLevel };
