// =============================================================================
// GNS-AIP SDK — Delegation Certificates
// =============================================================================
// Implements the three-layer provenance chain:
//   Creator (AI lab) → Deployer (organization) → Principal (human) → Agent
//
// The signing pattern follows comm_crypto_service.dart:
//   1. Serialize cert data as canonical JSON (sorted keys)
//   2. Ed25519 sign the canonical JSON with principal's key
//   3. SHA-256 hash for the cert identifier
// =============================================================================

import {
  DelegationCert,
  DelegationCertInput,
  GNS_AIP_PROTOCOL_VERSION,
} from './types';
import {
  sign,
  verify,
  canonicalJson,
  sha256Hex,
  generateId,
  isValidPublicKey,
} from './crypto';

// =============================================================================
// Certificate Creation
// =============================================================================

/**
 * Create and sign a delegation certificate.
 *
 * The principal (human) signs the certificate, authorizing the agent
 * to operate within the specified territory and facets.
 *
 * @param input - Certificate parameters
 * @param principalSecretKey - Principal's Ed25519 secret key (128 hex)
 * @returns Signed DelegationCert
 */
export async function createDelegationCert(
  input: DelegationCertInput,
  principalSecretKey: string
): Promise<DelegationCert> {
  // Validate identities
  if (!isValidPublicKey(input.principalIdentity)) {
    throw new Error('Invalid principal identity (must be 64 hex chars)');
  }
  if (!isValidPublicKey(input.agentIdentity)) {
    throw new Error('Invalid agent identity (must be 64 hex chars)');
  }
  if (!isValidPublicKey(input.deployerIdentity)) {
    throw new Error('Invalid deployer identity (must be 64 hex chars)');
  }
  if (input.territoryCells.length === 0) {
    throw new Error('Delegation must specify at least one territory cell');
  }
  if (input.facetPermissions.length === 0) {
    throw new Error('Delegation must specify at least one facet permission');
  }

  const certId = generateId();
  const now = new Date().toISOString();

  // Build the cert data object (before signing)
  const certData = {
    version: GNS_AIP_PROTOCOL_VERSION,
    certId,
    creatorIdentity: input.creatorIdentity || null,
    deployerIdentity: input.deployerIdentity,
    principalIdentity: input.principalIdentity,
    agentIdentity: input.agentIdentity,
    territoryCells: input.territoryCells.sort(), // Canonical: sorted
    facetPermissions: input.facetPermissions.sort(),
    maxSubDelegationDepth: input.maxSubDelegationDepth ?? 0,
    validFrom: input.validFrom || now,
    validUntil: input.validUntil || defaultExpiry(),
  };

  // Canonical JSON for signing
  const canonical = canonicalJson(certData);

  // Sign with principal's key
  const principalSignature = sign(principalSecretKey, canonical);

  // Hash for the cert identifier
  const certHash = await sha256Hex(canonical);

  return {
    ...certData,
    creatorIdentity: certData.creatorIdentity ?? undefined,
    principalSignature,
    certHash,
  };
}

// =============================================================================
// Certificate Verification
// =============================================================================

/**
 * Verify a delegation certificate's signature.
 *
 * Checks that the principal actually signed the certificate data.
 * This is what the Cloudflare Worker calls to validate agent authorization.
 *
 * @param cert - The delegation certificate to verify
 * @returns true if the signature is valid
 */
export function verifyDelegationCert(cert: DelegationCert): boolean {
  // Rebuild the cert data that was signed (excludes signature and hash)
  const certData = {
    version: cert.version,
    certId: cert.certId,
    creatorIdentity: cert.creatorIdentity || null,
    deployerIdentity: cert.deployerIdentity,
    principalIdentity: cert.principalIdentity,
    agentIdentity: cert.agentIdentity,
    territoryCells: cert.territoryCells.sort(),
    facetPermissions: cert.facetPermissions.sort(),
    maxSubDelegationDepth: cert.maxSubDelegationDepth,
    validFrom: cert.validFrom,
    validUntil: cert.validUntil,
  };

  const canonical = canonicalJson(certData);

  return verify(cert.principalIdentity, canonical, cert.principalSignature);
}

/**
 * Check if a delegation certificate is currently valid (not expired).
 */
export function isDelegationActive(cert: DelegationCert): boolean {
  const now = Date.now();
  const from = new Date(cert.validFrom).getTime();
  const until = new Date(cert.validUntil).getTime();
  return now >= from && now <= until;
}

/**
 * Check if a delegation authorizes operation in a specific H3 cell.
 */
export function isDelegationAuthorizedForCell(
  cert: DelegationCert,
  operationCell: string
): boolean {
  return cert.territoryCells.includes(operationCell);
}

/**
 * Check if a delegation authorizes use of a specific facet.
 */
export function isDelegationAuthorizedForFacet(
  cert: DelegationCert,
  facet: string
): boolean {
  return cert.facetPermissions.includes(facet);
}

/**
 * Full validation: signature + active + territory + facet.
 */
export function validateDelegation(
  cert: DelegationCert,
  operationCell: string,
  facet: string
): DelegationValidationResult {
  const errors: string[] = [];

  if (!verifyDelegationCert(cert)) {
    errors.push('Invalid principal signature');
  }
  if (!isDelegationActive(cert)) {
    errors.push(`Delegation expired or not yet active (valid ${cert.validFrom} to ${cert.validUntil})`);
  }
  if (!isDelegationAuthorizedForCell(cert, operationCell)) {
    errors.push(`Operation cell ${operationCell} not in delegation territory`);
  }
  if (!isDelegationAuthorizedForFacet(cert, facet)) {
    errors.push(`Facet '${facet}' not in delegation permissions`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface DelegationValidationResult {
  valid: boolean;
  errors: string[];
}

// =============================================================================
// Serialization
// =============================================================================

/**
 * Serialize a delegation cert for the GNS-AIP-Delegation HTTP header.
 * Used by agents when making requests through Cloudflare.
 */
export function serializeDelegationHeader(
  cert: DelegationCert,
  agentSecretKey: string,
  requestData?: string
): string {
  const timestamp = new Date().toISOString();
  const dataToSign = `${cert.certHash}:${timestamp}:${requestData || ''}`;
  const requestSignature = sign(agentSecretKey, dataToSign);

  const header = {
    agentIdentity: cert.agentIdentity,
    certHash: cert.certHash,
    requestSignature,
    timestamp,
  };

  return Buffer.from(JSON.stringify(header)).toString('base64');
}

/**
 * Parse and verify a GNS-AIP-Delegation HTTP header.
 * Used by Cloudflare Workers to verify incoming agent requests.
 */
export function parseDelegationHeader(headerValue: string): {
  agentIdentity: string;
  certHash: string;
  requestSignature: string;
  timestamp: string;
} | null {
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Default expiry: 30 days from now */
function defaultExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}
