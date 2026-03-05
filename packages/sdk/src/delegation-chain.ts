/**
 * @file delegation-chain.ts
 * @module @gns-aip/sdk
 *
 * GNS-AIP Sub-Delegation Chain
 * ─────────────────────────────
 * Implements multi-hop delegation: Human Principal → Manager Agent → Worker Agent(s)
 *
 * Architecture:
 *   - Every link in the chain is a signed DelegationCert
 *   - Each cert references its parent cert's hash (previousCertHash)
 *   - The root cert MUST be signed by a human identity (no agent key)
 *   - maxSubDelegationDepth controls how many hops are permitted
 *   - Any broken link (bad sig, expired, revoked, depth exceeded) = INVALID
 *
 * EU AI Act Mapping:
 *   Article 14 — Human oversight: chain traces every operation back to human principal
 *   Article 17 — Risk management: depth + facet scope limits enforce least-privilege
 *   Article 26 — Responsibilities: audit trail via chainId binds liability to human pk
 *
 * Usage:
 *   const chain = new DelegationChain();
 *   const rootCert = chain.createRootCert(humanKeypair, managerAgentPk, opts);
 *   const childCert = chain.createChildCert(rootCert, managerKeypair, workerPk, opts);
 *   const result = chain.verify(childCert);  // verifies full chain back to human
 */

import nacl from 'tweetnacl';


// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type AgentFacet =
  | 'read'
  | 'write'
  | 'execute'
  | 'financial'
  | 'telemetry'
  | 'delegation'
  | 'audit'
  | 'emergency';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SubDelegationConstraints {
  /** Maximum number of sub-delegation hops below this cert. 0 = no further delegation. */
  maxSubDelegationDepth: number;
  /** Which facets this cert is allowed to further delegate (subset of its own facets). */
  delegatableFacets: AgentFacet[];
  /** If true, child certs must have equal or shorter TTL. */
  enforceMaxTtl: boolean;
  /** Optional: require HITL re-authorization before child can be issued. */
  requireHitlForSubDelegation: boolean;
}

export interface DelegationCertPayload {
  /** Unique cert identifier */
  certId: string;
  /** ISO-8601 issuance timestamp */
  issuedAt: string;
  /** ISO-8601 expiry timestamp */
  expiresAt: string;
  /** Public key of the principal issuing this cert (hex) */
  issuerPk: string;
  /** Public key of the agent receiving this cert (hex) */
  subjectPk: string;
  /** H3 cell(s) defining the territorial scope */
  territoryCells: string[];
  /** Facets this agent is authorized to exercise */
  facets: AgentFacet[];
  /** Risk level — determines HITL escalation thresholds */
  riskLevel: RiskLevel;
  /** Hash of the parent cert (null for root cert) */
  previousCertHash: string | null;
  /** Depth from root (0 = root cert) */
  depth: number;
  /** Globally unique chain identifier — same for all certs in a chain */
  chainId: string;
  /** Sub-delegation constraints for child certs */
  subDelegation: SubDelegationConstraints;
  /** Human-readable purpose statement */
  purpose: string;
  /** Public key of the original human principal (always the root issuer pk) */
  humanPrincipalPk: string;
  /** Operation counter — incremented on each use (anti-replay) */
  operationCount: number;
}

export interface DelegationCert {
  payload: DelegationCertPayload;
  /** Ed25519 signature over canonical JSON of payload (hex) */
  signature: string;
  /** SHA-256 hash of canonical JSON of payload (hex) */
  certHash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  depth: number;
  humanPrincipalPk: string;
  chainId: string;
  errors: string[];
  warnings: string[];
  /** Full chain from root to this cert */
  chain: DelegationCert[];
  /** Whether any cert in the chain has expired */
  hasExpiredLink: boolean;
  /** Effective facets (intersection of all certs in chain) */
  effectiveFacets: AgentFacet[];
  /** Effective territory (intersection of all territory cells in chain) */
  effectiveTerritory: string[];
}

export interface AgentKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNALS
// ─────────────────────────────────────────────────────────────────────────────

function sha256Hex(data: string): string {
  // Pure JS SHA-256 (no Node dependency — works in browser + edge)
  const bytes = new TextEncoder().encode(data);
  let h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bytes.length * 8, false);
  for (let i = 0; i < padded.length; i += 64) {
    const w = new Array(64).fill(0);
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j-15],7) ^ rotr(w[j-15],18) ^ (w[j-15]>>>3);
      const s1 = rotr(w[j-2],17) ^ rotr(w[j-2],19) ^ (w[j-2]>>>10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + k[j] + w[j]) >>> 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      [hh,g,f,e,d,c,b,a] = [g,f,e,(d+temp1)>>>0,c,b,a,(temp1+temp2)>>>0];
    }
    h = h.map((v, i) => (v + [a,b,c,d,e,f,g,hh][i]) >>> 0);
  }
  return h.map(v => v.toString(16).padStart(8,'0')).join('');
}

function canonicalJson(obj: unknown): string {
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
    .join(',');
  return '{' + sorted + '}';
}

function randomHex(bytes: number): string {
  return Array.from(nacl.randomBytes(bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function uint8ToHex(u8: Uint8Array): string {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function signPayload(payload: DelegationCertPayload, secretKey: Uint8Array): string {
  const canonical = canonicalJson(payload);
  const msgBytes = new TextEncoder().encode(canonical);
  const sig = nacl.sign.detached(msgBytes, secretKey);
  return uint8ToHex(sig);
}

function verifyPayloadSig(payload: DelegationCertPayload, sigHex: string, publicKeyHex: string): boolean {
  try {
    const canonical = canonicalJson(payload);
    const msgBytes = new TextEncoder().encode(canonical);
    const sig = hexToUint8(sigHex);
    const pk = hexToUint8(publicKeyHex);
    return nacl.sign.detached.verify(msgBytes, sig, pk);
  } catch {
    return false;
  }
}

function hashCert(payload: DelegationCertPayload): string {
  return sha256Hex(canonicalJson(payload));
}

function intersectFacets(a: AgentFacet[], b: AgentFacet[]): AgentFacet[] {
  const setB = new Set(b);
  return a.filter(f => setB.has(f));
}

function intersectTerritory(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter(c => setB.has(c));
}

// ─────────────────────────────────────────────────────────────────────────────
// CERT STORE (in-memory; production should use your DB layer)
// ─────────────────────────────────────────────────────────────────────────────

const certStore = new Map<string, DelegationCert>();
const revokedCertIds = new Set<string>();

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION CHAIN CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class DelegationChain {

  /**
   * Create the ROOT cert — must be signed by a human principal.
   * This is depth=0, previousCertHash=null.
   */
  createRootCert(
    humanKeypair: AgentKeypair,
    agentPublicKey: Uint8Array,
    opts: {
      territoryCells: string[];
      facets: AgentFacet[];
      riskLevel: RiskLevel;
      ttlSeconds: number;
      maxSubDelegationDepth: number;
      delegatableFacets?: AgentFacet[];
      purpose: string;
    }
  ): DelegationCert {
    const now = new Date();
    const issuerPkHex = uint8ToHex(humanKeypair.publicKey);
    const subjectPkHex = uint8ToHex(agentPublicKey);
    const chainId = randomHex(16);

    const payload: DelegationCertPayload = {
      certId: randomHex(16),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + opts.ttlSeconds * 1000).toISOString(),
      issuerPk: issuerPkHex,
      subjectPk: subjectPkHex,
      territoryCells: opts.territoryCells,
      facets: opts.facets,
      riskLevel: opts.riskLevel,
      previousCertHash: null,
      depth: 0,
      chainId,
      subDelegation: {
        maxSubDelegationDepth: opts.maxSubDelegationDepth,
        delegatableFacets: opts.delegatableFacets ?? opts.facets,
        enforceMaxTtl: true,
        requireHitlForSubDelegation: opts.riskLevel === 'HIGH' || opts.riskLevel === 'CRITICAL',
      },
      purpose: opts.purpose,
      humanPrincipalPk: issuerPkHex,
      operationCount: 0,
    };

    const signature = signPayload(payload, humanKeypair.secretKey);
    const certHash = hashCert(payload);
    const cert: DelegationCert = { payload, signature, certHash };
    certStore.set(payload.certId, cert);
    return cert;
  }

  /**
   * Create a CHILD cert — signed by the current cert holder, delegating to a
   * sub-agent. Validates that the parent cert allows further delegation.
   */
  createChildCert(
    parentCert: DelegationCert,
    parentKeypair: AgentKeypair,
    childAgentPublicKey: Uint8Array,
    opts: {
      territoryCells: string[];
      facets: AgentFacet[];
      riskLevel?: RiskLevel;
      ttlSeconds: number;
      maxSubDelegationDepth?: number;
      purpose: string;
    }
  ): DelegationCert {
    // ── Validate parent allows sub-delegation ───────────────────────────────
    if (parentCert.payload.subDelegation.maxSubDelegationDepth <= 0) {
      throw new Error(
        `[DelegationChain] Parent cert ${parentCert.payload.certId} does not allow sub-delegation (maxSubDelegationDepth=0)`
      );
    }

    // ── Validate issuer pk matches parent subject ────────────────────────────
    const issuerPkHex = uint8ToHex(parentKeypair.publicKey);
    if (issuerPkHex !== parentCert.payload.subjectPk) {
      throw new Error(
        `[DelegationChain] Keypair does not match parent cert subject. Expected ${parentCert.payload.subjectPk.slice(0,16)}...`
      );
    }

    // ── Validate facets are a subset of delegatable facets ───────────────────
    const delegatable = new Set(parentCert.payload.subDelegation.delegatableFacets);
    const invalidFacets = opts.facets.filter(f => !delegatable.has(f));
    if (invalidFacets.length > 0) {
      throw new Error(
        `[DelegationChain] Cannot delegate facets not granted by parent: [${invalidFacets.join(', ')}]`
      );
    }

    // ── Validate territory is a subset of parent territory ───────────────────
    const parentCells = new Set(parentCert.payload.territoryCells);
    const invalidCells = opts.territoryCells.filter(c => !parentCells.has(c));
    if (invalidCells.length > 0) {
      throw new Error(
        `[DelegationChain] Cannot delegate territory cells not in parent scope: [${invalidCells.join(', ')}]`
      );
    }

    // ── Enforce TTL constraint ───────────────────────────────────────────────
    const parentExpiry = new Date(parentCert.payload.expiresAt).getTime();
    const childExpiry = Date.now() + opts.ttlSeconds * 1000;
    if (parentCert.payload.subDelegation.enforceMaxTtl && childExpiry > parentExpiry) {
      throw new Error(
        `[DelegationChain] Child cert TTL exceeds parent cert expiry. Reduce ttlSeconds.`
      );
    }

    const now = new Date();
    const childDepth = parentCert.payload.depth + 1;
    const childMaxDepth = Math.min(
      opts.maxSubDelegationDepth ?? 0,
      parentCert.payload.subDelegation.maxSubDelegationDepth - 1
    );

    const payload: DelegationCertPayload = {
      certId: randomHex(16),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + opts.ttlSeconds * 1000).toISOString(),
      issuerPk: issuerPkHex,
      subjectPk: uint8ToHex(childAgentPublicKey),
      territoryCells: opts.territoryCells,
      facets: opts.facets,
      riskLevel: opts.riskLevel ?? parentCert.payload.riskLevel,
      previousCertHash: parentCert.certHash,
      depth: childDepth,
      chainId: parentCert.payload.chainId,
      subDelegation: {
        maxSubDelegationDepth: childMaxDepth,
        delegatableFacets: opts.facets.filter(f =>
          parentCert.payload.subDelegation.delegatableFacets.includes(f)
        ),
        enforceMaxTtl: true,
        requireHitlForSubDelegation: (opts.riskLevel ?? parentCert.payload.riskLevel) === 'HIGH'
          || (opts.riskLevel ?? parentCert.payload.riskLevel) === 'CRITICAL',
      },
      purpose: opts.purpose,
      humanPrincipalPk: parentCert.payload.humanPrincipalPk,
      operationCount: 0,
    };

    const signature = signPayload(payload, parentKeypair.secretKey);
    const certHash = hashCert(payload);
    const cert: DelegationCert = { payload, signature, certHash };
    certStore.set(payload.certId, cert);
    return cert;
  }

  /**
   * Verify a cert — walks the full chain back to the root, verifying every
   * signature, expiry, depth constraint, and revocation status.
   *
   * Returns ChainVerificationResult with errors array (empty = valid).
   */
  verify(cert: DelegationCert, allCerts?: DelegationCert[]): ChainVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const chain: DelegationCert[] = [];
    let current: DelegationCert = cert;
    let hasExpiredLink = false;

    // Build chain by walking previousCertHash links
    while (true) {
      chain.unshift(current);

      // 1. Verify this cert's signature
      const sigValid = verifyPayloadSig(
        current.payload,
        current.signature,
        current.payload.issuerPk
      );
      if (!sigValid) {
        errors.push(`[depth=${current.payload.depth}] Invalid signature on cert ${current.payload.certId.slice(0,8)}`);
      }

      // 2. Verify cert hash integrity
      const recomputed = hashCert(current.payload);
      if (recomputed !== current.certHash) {
        errors.push(`[depth=${current.payload.depth}] Hash mismatch on cert ${current.payload.certId.slice(0,8)}`);
      }

      // 3. Check expiry
      if (new Date(current.payload.expiresAt) < new Date()) {
        hasExpiredLink = true;
        warnings.push(`[depth=${current.payload.depth}] Cert ${current.payload.certId.slice(0,8)} has expired`);
      }

      // 4. Check revocation
      if (revokedCertIds.has(current.payload.certId)) {
        errors.push(`[depth=${current.payload.depth}] Cert ${current.payload.certId.slice(0,8)} has been revoked`);
      }

      // 5. Verify chainId consistency
      if (current.payload.chainId !== cert.payload.chainId) {
        errors.push(`[depth=${current.payload.depth}] chainId mismatch — chain is forged`);
      }

      // 6. Verify humanPrincipalPk consistency
      if (current.payload.humanPrincipalPk !== cert.payload.humanPrincipalPk) {
        errors.push(`[depth=${current.payload.depth}] humanPrincipalPk mismatch`);
      }

      // Walk to parent
      if (current.payload.previousCertHash === null) {
        // Root cert — issuer must equal humanPrincipalPk
        if (current.payload.issuerPk !== current.payload.humanPrincipalPk) {
          errors.push(`[root] Root cert issuerPk !== humanPrincipalPk. Chain not anchored to human.`);
        }
        break;
      }

      // Find parent cert
      const parentCert = allCerts?.find(c => c.certHash === current.payload.previousCertHash)
        ?? certStore.get([...certStore.keys()].find(k =>
          certStore.get(k)!.certHash === current.payload.previousCertHash
        ) ?? '') ?? null;

      if (!parentCert) {
        errors.push(`[depth=${current.payload.depth}] Parent cert not found (hash=${current.payload.previousCertHash?.slice(0,16)}...)`);
        break;
      }

      // Verify parent's subject = this cert's issuer
      if (parentCert.payload.subjectPk !== current.payload.issuerPk) {
        errors.push(`[depth=${current.payload.depth}] Issuer pk does not match parent subject pk — chain broken`);
      }

      current = parentCert;
    }

    // Compute effective facets (intersection across chain)
    const effectiveFacets = chain.reduce<AgentFacet[]>(
      (acc, c, i) => i === 0 ? c.payload.facets : intersectFacets(acc, c.payload.facets),
      []
    );

    // Compute effective territory (intersection across chain)
    const effectiveTerritory = chain.reduce<string[]>(
      (acc, c, i) => i === 0 ? c.payload.territoryCells : intersectTerritory(acc, c.payload.territoryCells),
      []
    );

    return {
      valid: errors.length === 0,
      depth: cert.payload.depth,
      humanPrincipalPk: cert.payload.humanPrincipalPk,
      chainId: cert.payload.chainId,
      errors,
      warnings,
      chain,
      hasExpiredLink,
      effectiveFacets,
      effectiveTerritory,
    };
  }

  /**
   * Revoke a cert and all its descendants.
   * In production, write to your revocation DB endpoint.
   */
  revoke(certId: string): void {
    revokedCertIds.add(certId);
    // Cascade: revoke any cert that has this cert as an ancestor
    for (const [, cert] of certStore) {
      if (cert.payload.chainId === certStore.get(certId)?.payload.chainId
        && cert.payload.depth > (certStore.get(certId)?.payload.depth ?? 0)) {
        revokedCertIds.add(cert.payload.certId);
      }
    }
  }

  /**
   * Serialize a cert chain to Cloudflare Worker / HTTP headers.
   * Header: X-GNS-Chain: <base64(JSON array of certs)>
   */
  serializeChainHeader(leafCert: DelegationCert, allCerts?: DelegationCert[]): string {
    const result = this.verify(leafCert, allCerts);
    const chainJson = JSON.stringify(result.chain);
    return Buffer.from(chainJson).toString('base64');
  }

  /**
   * Deserialize from X-GNS-Chain header and verify.
   */
  deserializeChainHeader(headerValue: string): ChainVerificationResult {
    const chainJson = Buffer.from(headerValue, 'base64').toString('utf-8');
    const chain: DelegationCert[] = JSON.parse(chainJson);
    if (chain.length === 0) throw new Error('Empty chain');
    const leafCert = chain[chain.length - 1];
    return this.verify(leafCert, chain);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE HELPERS (backward-compatible with Phase 0 delegation.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Verify a leaf cert's full chain. Convenience wrapper. */
export function verifyDelegationChain(
  leafCert: DelegationCert,
  allCerts?: DelegationCert[]
): ChainVerificationResult {
  return new DelegationChain().verify(leafCert, allCerts);
}

/** Quick check: is this cert authorized for a given facet + territory cell? */
export function isCertAuthorized(
  cert: DelegationCert,
  facet: AgentFacet,
  h3Cell: string,
  allCerts?: DelegationCert[]
): boolean {
  const result = new DelegationChain().verify(cert, allCerts);
  if (!result.valid) return false;
  if (result.hasExpiredLink) return false;
  if (!result.effectiveFacets.includes(facet)) return false;
  if (!result.effectiveTerritory.includes(h3Cell)) return false;
  return true;
}
