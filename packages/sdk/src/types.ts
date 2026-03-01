// =============================================================================
// GNS-AIP SDK — Type Definitions
// =============================================================================
// These types define the complete data model for AI agent identities in the
// GNS Protocol. Every downstream system (framework integrations, dashboard,
// Cloudflare Worker, pilots) codes against these types.
// =============================================================================

// =============================================================================
// Constants
// =============================================================================

export const GNS_AIP_VERSION = '0.1.0';
export const GNS_AIP_PROTOCOL_VERSION = 1;

export const GNS_CONSTANTS = {
  /** Ed25519 public key length in hex chars (32 bytes = 64 hex) */
  PK_HEX_LENGTH: 64,
  /** Ed25519 signature length in hex chars (64 bytes = 128 hex) */
  SIG_HEX_LENGTH: 128,
  /** H3 resolution for agent territorial binding (city-district level, ~5 km²) */
  AGENT_H3_RESOLUTION: 7,
  /** H3 resolution for precise operations (building level, ~0.015 km²) */
  PRECISE_H3_RESOLUTION: 10,
  /** GNS tokens required to provision an agent identity */
  PROVISION_COST_GNS: 100,
  /** GNS tokens per delegation certificate */
  DELEGATION_COST_GNS: 1,
  /** GNS tokens per additional territory cell */
  TERRITORY_COST_GNS: 10,
  /** Handle regex: 3-32 chars, alphanumeric + underscore, must start with letter */
  HANDLE_REGEX: /^[a-z][a-z0-9_]{2,31}$/,
  /** Agent handle regex: handle@territory */
  AGENT_HANDLE_REGEX: /^[a-z][a-z0-9_]{2,31}@[a-z][a-z0-9_-]{1,31}$/,
} as const;

// =============================================================================
// Agent Identity
// =============================================================================

/** The type of entity this identity represents */
export type IdentityType = 'human' | 'agent';

/** Agent operational category determining facet permissions */
export type AgentDomain =
  | 'health'     // Medical data processing — GDPR + EU AI Act
  | 'finance'    // Financial transactions — FINMA + MiFID II
  | 'legal'      // Legal document analysis — jurisdiction-specific
  | 'creator'    // Content moderation — DSA compliance
  | 'transport'  // Autonomous vehicles — EU Motor Vehicle Reg
  | 'general';   // General-purpose agent

/**
 * Core agent identity — the Ed25519 keypair that IS the agent.
 * 
 * Mirrors GnsKeypair from identity_keypair.dart:
 * - Ed25519 for identity + signing
 * - Public key = identity = Stellar wallet address
 * - No X25519 for agents (agents don't need E2E encryption)
 */
export interface AgentIdentity {
  /** Ed25519 public key (64 hex chars) — this IS the identity */
  publicKey: string;
  /** Ed25519 secret key (128 hex chars — 64-byte NaCl expanded key) */
  secretKey: string;
  /** GNS ID derived from public key: `gns_${pk[0:16]}` */
  gnsId: string;
  /** Stellar wallet address (G...) derived from same Ed25519 key */
  stellarAddress: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** Identity type discriminator */
  type: 'agent';
}

/**
 * Serializable agent identity (excludes secret key for storage/transmission)
 */
export interface AgentIdentityPublic {
  publicKey: string;
  gnsId: string;
  stellarAddress: string;
  createdAt: string;
  type: 'agent';
}

// =============================================================================
// Jurisdictional Scope — H3 Territorial Binding
// =============================================================================

/**
 * Defines where an agent is legally authorized to operate.
 * 
 * Ported from h3_quantizer.dart: uses H3 hexagonal cells to quantize
 * territory. Resolution 7 ≈ 5.161 km² per cell (city-district level).
 * 
 * This is NOT a suggestion — it is a cryptographic constraint enforced
 * at the protocol level. An agent operating outside its bound cells
 * generates a compliance violation.
 */
export interface JurisdictionalScope {
  /** Array of H3 cell indices (hex strings) defining the territory */
  cells: string[];
  /** H3 resolution level (default: 7 for ~5 km² districts) */
  resolution: number;
  /** Human-readable territory labels (e.g., ["EU", "Switzerland"]) */
  labels: string[];
  /** ISO 3166-1 alpha-2 country codes covered */
  countryCodes: string[];
}

// =============================================================================
// Delegation Certificate
// =============================================================================

/**
 * Cryptographic proof that a human authorized an AI agent.
 * 
 * The delegation certificate answers the fundamental regulatory question:
 * "Which human authorized this AI action?"
 * 
 * Signing pattern from comm_crypto_service.dart:
 * 1. Serialize cert data as canonical JSON (sorted keys)
 * 2. SHA-256 hash the canonical JSON
 * 3. Ed25519 sign the hash with principal's secret key
 */
export interface DelegationCert {
  /** Protocol version */
  version: number;
  /** Unique certificate identifier (hex) */
  certId: string;

  // === Three-Layer Provenance ===
  /** Layer 1: Creator — the AI lab that built the model */
  creatorIdentity?: string;
  /** Layer 2: Deployer — the organization provisioning the agent */
  deployerIdentity: string;
  /** Layer 3: Principal — the human authorizing this specific agent */
  principalIdentity: string;
  /** The agent being delegated to */
  agentIdentity: string;

  // === Scope Constraints ===
  /** H3 cells where the agent may operate */
  territoryCells: string[];
  /** Facets the agent is permitted to use */
  facetPermissions: string[];
  /** Maximum sub-delegation depth (0 = agent cannot delegate further) */
  maxSubDelegationDepth: number;

  // === Time Window ===
  /** ISO 8601: when delegation becomes active */
  validFrom: string;
  /** ISO 8601: when delegation expires */
  validUntil: string;

  // === Cryptographic Proof ===
  /** Ed25519 signature by the principal over canonical cert data */
  principalSignature: string;
  /** SHA-256 hash of the canonical cert data */
  certHash: string;
}

/**
 * Input for creating a delegation certificate (before signing)
 */
export interface DelegationCertInput {
  creatorIdentity?: string;
  deployerIdentity: string;
  principalIdentity: string;
  agentIdentity: string;
  territoryCells: string[];
  facetPermissions: string[];
  maxSubDelegationDepth?: number;
  validFrom?: string;
  validUntil?: string;
}

// =============================================================================
// Virtual Breadcrumb — Agent Audit Trail
// =============================================================================

/**
 * A single audit record in the agent's Proof-of-Jurisdiction chain.
 * 
 * Ported from breadcrumb_block.dart:
 * - Same hash-linked chain structure as human breadcrumbs
 * - Instead of GPS location, records operational territory
 * - Instead of device sensors, records operation metadata
 * 
 * Human breadcrumbs prove "I was HERE" (Proof-of-Trajectory).
 * Agent breadcrumbs prove "I operated WITHIN my jurisdiction" (Proof-of-Jurisdiction).
 */
export interface VirtualBreadcrumb {
  /** Sequential index in the agent's breadcrumb chain */
  index: number;
  /** Agent's Ed25519 public key (64 hex chars) */
  agentIdentity: string;
  /** ISO 8601 UTC timestamp */
  timestamp: string;
  /** H3 cell where the operation occurred (hex string) */
  operationCell: string;
  /** H3 resolution of the operation cell */
  cellResolution: number;
  /** SHA-256 hash of operation context (see OperationContext) */
  contextDigest: string;
  /** SHA-256 hash of the previous breadcrumb (null for genesis) */
  previousHash: string | null;
  /** Operation metadata */
  meta: VirtualBreadcrumbMeta;
  /** Ed25519 signature over canonical breadcrumb data */
  signature: string;
  /** SHA-256 hash of this breadcrumb (computed: dataToSign + signature) */
  blockHash: string;
}

/**
 * Metadata for a virtual breadcrumb operation
 */
export interface VirtualBreadcrumbMeta {
  /** Type of operation: 'query', 'inference', 'transaction', 'delegation', 'moderation' */
  operationType: string;
  /** Delegation certificate hash authorizing this operation */
  delegationCertHash: string;
  /** Facet used for this operation (e.g., 'health', 'finance') */
  facet: string;
  /** Whether the operation was within territorial scope */
  withinTerritory: boolean;
  /** Optional: response time in ms */
  latencyMs?: number;
  /** Optional: model identifier */
  modelId?: string;
}

/**
 * Context data hashed into the breadcrumb's contextDigest
 */
export interface OperationContext {
  /** H3 cell of the operation */
  h3Cell: string;
  /** ISO 8601 timestamp (bucketed to 5-minute intervals for privacy) */
  timestamp: string;
  /** Operation type identifier */
  operationType: string;
  /** Delegation cert hash */
  delegationCertHash: string;
  /** Optional: input data hash (never raw data) */
  inputHash?: string;
  /** Optional: output data hash (never raw data) */
  outputHash?: string;
}

// =============================================================================
// Compliance Score — TierGate for AI Agents
// =============================================================================

/** Agent trust tiers (mirrors human trajectory tiers) */
export type ComplianceTier =
  | 'provisioned'  // 0 ops,     0% score  — Read-only, sandboxed
  | 'observed'     // 50+ ops,  25% score  — Basic processing
  | 'trusted'      // 500+ ops, 60% score  — Data processing (PII)
  | 'certified'    // 5K+ ops,  85% score  — Financial transactions
  | 'sovereign';   // 50K+ ops, 99% score  — Full autonomy

export const TIER_THRESHOLDS: Record<ComplianceTier, { minOps: number; minScore: number }> = {
  provisioned: { minOps: 0, minScore: 0 },
  observed:    { minOps: 50, minScore: 25 },
  trusted:     { minOps: 500, minScore: 60 },
  certified:   { minOps: 5000, minScore: 85 },
  sovereign:   { minOps: 50000, minScore: 99 },
};

/**
 * Compliance score for an AI agent
 */
export interface ComplianceScore {
  /** Current tier */
  tier: ComplianceTier;
  /** Numeric score 0-100 */
  score: number;
  /** Total operations performed */
  totalOperations: number;
  /** Operations within declared territory */
  withinTerritoryOps: number;
  /** Territory compliance rate (0.0-1.0) */
  territoryComplianceRate: number;
  /** Number of delegation cert violations */
  violationCount: number;
  /** Unique H3 cells operated in */
  uniqueCells: number;
  /** Days since provisioning */
  daysSinceProvisioning: number;
  /** Chain integrity verified */
  chainValid: boolean;
  /** ISO 8601 timestamp of last update */
  lastUpdated: string;
}

// =============================================================================
// Agent Manifest — The Public Identity Document
// =============================================================================

/**
 * The agent's public manifest — published to the GNS network.
 * 
 * Extends the GnsRecord pattern from gns_record.dart / records.ts.
 * This is what anyone resolving the agent's identity will see.
 */
export interface AgentManifest {
  /** Protocol version */
  version: number;
  /** Agent's Ed25519 public key */
  identity: string;
  /** Agent handle (e.g., "diag_agent@eu") */
  handle?: string;
  /** Agent domain/specialization */
  domain: AgentDomain;
  /** Display name */
  name: string;
  /** Description of agent capabilities */
  description: string;

  // === Deployer Info ===
  /** Deployer organization's GNS identity */
  deployerIdentity: string;
  /** Deployer organization name */
  deployerName: string;

  // === Territorial Binding ===
  /** H3 cells the agent is bound to */
  jurisdiction: JurisdictionalScope;

  // === Compliance ===
  /** Current compliance score */
  complianceScore: number;
  /** Current tier */
  complianceTier: ComplianceTier;
  /** Total breadcrumbs in audit chain */
  breadcrumbCount: number;

  // === Active Delegations ===
  /** Hashes of currently active delegation certificates */
  activeDelegations: string[];

  // === Facets ===
  /** Active facet identifiers */
  facets: string[];

  // === Timestamps ===
  createdAt: string;
  updatedAt: string;
}

/**
 * Signed manifest for network publication
 */
export interface SignedAgentManifest {
  /** Agent's public key */
  identity: string;
  /** The manifest data */
  manifest: AgentManifest;
  /** Ed25519 signature over canonical manifest JSON */
  signature: string;
}

// =============================================================================
// Agent Facets — Vertical Capability Scoping
// =============================================================================

/**
 * Predefined agent facets mapped to regulatory domains.
 * Ported from protocol_facets.dart, extended for AI agents.
 */
export const AGENT_FACETS: Record<string, AgentFacetConfig> = {
  health: {
    id: 'health',
    name: 'Healthcare Agent',
    description: 'Medical data processing — GDPR Article 22 + EU AI Act compliance',
    regulations: ['GDPR', 'EU_AI_ACT', 'HIPAA'],
    requiredTier: 'trusted',
  },
  finance: {
    id: 'finance',
    name: 'Financial Services Agent',
    description: 'Financial transactions and advisory — FINMA + MiFID II compliance',
    regulations: ['FINMA', 'MIFID_II', 'CCPA'],
    requiredTier: 'certified',
  },
  legal: {
    id: 'legal',
    name: 'Legal Agent',
    description: 'Legal document analysis — jurisdiction-specific regulatory compliance',
    regulations: ['GDPR', 'CCPA'],
    requiredTier: 'trusted',
  },
  creator: {
    id: 'creator',
    name: 'Content Moderation Agent',
    description: 'Content moderation and labeling — DSA + platform-specific rules',
    regulations: ['DSA', 'NETZOG', 'SECTION_230'],
    requiredTier: 'observed',
  },
  transport: {
    id: 'transport',
    name: 'Transport Agent',
    description: 'Autonomous vehicle / logistics AI — motor vehicle + transport regulations',
    regulations: ['EU_MOTOR_VEHICLE', 'DOT'],
    requiredTier: 'sovereign',
  },
  general: {
    id: 'general',
    name: 'General Agent',
    description: 'General-purpose AI agent — baseline compliance requirements',
    regulations: [],
    requiredTier: 'provisioned',
  },
};

export interface AgentFacetConfig {
  id: string;
  name: string;
  description: string;
  regulations: string[];
  requiredTier: ComplianceTier;
}

// =============================================================================
// API Types — For GNS Node Communication
// =============================================================================

/** Request to provision an agent identity */
export interface ProvisionRequest {
  /** Deployer's Ed25519 public key (must be registered human identity) */
  deployerIdentity: string;
  /** Agent domain */
  domain: AgentDomain;
  /** Agent display name */
  name: string;
  /** Agent description */
  description: string;
  /** H3 territorial cells */
  jurisdiction: JurisdictionalScope;
  /** Deployer's Ed25519 signature over the request body */
  deployerSignature: string;
}

/** Response from agent provisioning */
export interface ProvisionResponse {
  success: boolean;
  agent?: AgentIdentityPublic;
  manifest?: AgentManifest;
  stellarAddress?: string;
  error?: string;
}

/** Request to create a delegation certificate */
export interface DelegateRequest {
  cert: DelegationCertInput;
  principalSignature: string;
}

/** GNS-AIP HTTP header for Cloudflare Worker verification */
export interface AIPDelegationHeader {
  /** Agent's Ed25519 public key */
  agentIdentity: string;
  /** Delegation certificate hash */
  certHash: string;
  /** Agent's signature over the current request */
  requestSignature: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}
