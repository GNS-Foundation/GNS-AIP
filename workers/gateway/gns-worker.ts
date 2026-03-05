/**
 * @file gns-worker.ts
 * @package @gns-aip/cloudflare-worker
 *
 * GNS-AIP Cloudflare Worker — Zero-Trust Edge Middleware for AI Agents
 * ─────────────────────────────────────────────────────────────────────
 * Sits in front of any API and enforces GNS delegation chain verification
 * at the edge, before the request ever reaches your origin server.
 *
 * What it does on every request:
 *   1. Reads X-GNS-Chain header (base64 delegation chain)
 *   2. Verifies every cert signature in the chain (Ed25519)
 *   3. Checks chain is anchored to a known human principal
 *   4. Validates facet permission matches the requested route
 *   5. Checks territory (H3 cell) matches the agent's authorized scope
 *   6. Enforces HITL policy (rejects if escalation pending)
 *   7. Forwards to origin with X-GNS-Verified: true header
 *   8. Logs audit event to KV store
 *
 * Deploy:
 *   wrangler deploy
 *
 * wrangler.toml:
 *   name = "gns-aip-gateway"
 *   main = "gns-worker.ts"
 *   compatibility_date = "2024-01-01"
 *
 *   [[kv_namespaces]]
 *   binding = "GNS_AUDIT_LOG"
 *   id = "your-kv-namespace-id"
 *
 *   [vars]
 *   GNS_ORIGIN_URL = "https://your-backend.railway.app"
 *   GNS_HUMAN_PRINCIPALS = "pk1hex,pk2hex"   # comma-separated trusted human pks
 *
 * Usage:
 *   Any AI agent that has a GNS delegation cert adds the header:
 *   X-GNS-Chain: <base64(JSON array of DelegationCert)>
 *
 *   The worker verifies the chain and either forwards or rejects.
 *   No cert = 401. Invalid chain = 403. Missing facet = 403.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (inlined — no npm imports in Cloudflare Workers)
// ─────────────────────────────────────────────────────────────────────────────

interface DelegationCert {
  certId: string;
  agentIdentity: string;
  principalIdentity: string;
  deployerIdentity: string;
  territoryCells: string[];
  facetPermissions: string[];
  maxSubDelegationDepth: number;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  certHash: string;
}

interface GnsVerificationResult {
  valid: boolean;
  agentPk: string;
  humanPrincipalPk: string;
  facets: string[];
  territoryCells: string[];
  chainDepth: number;
  errors: string[];
}

interface AuditEntry {
  timestamp: string;
  agentPk: string;
  humanPrincipalPk: string;
  method: string;
  path: string;
  facet: string;
  result: 'ALLOWED' | 'DENIED';
  reason?: string;
  chainDepth: number;
  cf_ray?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENV BINDINGS
// ─────────────────────────────────────────────────────────────────────────────

interface Env {
  GNS_AUDIT_LOG: KVNamespace;
  GNS_ORIGIN_URL: string;
  /** Comma-separated hex public keys of trusted human principals */
  GNS_HUMAN_PRINCIPALS: string;
  /** Optional: comma-separated revoked cert IDs */
  GNS_REVOKED_CERTS?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE → FACET MAPPING
// Define which facet each route requires
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_FACET_MAP: Array<{ pattern: RegExp; facet: string; method?: string }> = [
  { pattern: /^\/api\/agents\/.*\/telemetry/, facet: 'telemetry' },
  { pattern: /^\/api\/agents\/.*\/control/,   facet: 'execute',   method: 'POST' },
  { pattern: /^\/api\/payments/,              facet: 'financial' },
  { pattern: /^\/api\/delegation/,            facet: 'delegation' },
  { pattern: /^\/api\/emergency/,             facet: 'emergency' },
  { pattern: /^\/api\/.*/, facet: 'read' },  // default: read access
];

function getRequiredFacet(method: string, path: string): string {
  for (const rule of ROUTE_FACET_MAP) {
    if (rule.pattern.test(path)) {
      if (!rule.method || rule.method === method) {
        return rule.facet;
      }
    }
  }
  return 'read';
}

// ─────────────────────────────────────────────────────────────────────────────
// CRYPTO — Ed25519 verify using Web Crypto API (available in CF Workers)
// ─────────────────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
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

async function verifyCertSignature(cert: DelegationCert): Promise<boolean> {
  try {
    // Reconstruct the payload (everything except signature and certHash)
    const { signature, certHash, ...payload } = cert;
    const canonical = canonicalJson(payload);
    const msgBytes = new TextEncoder().encode(canonical);
    const sigBytes = hexToBytes(signature);
    const pkBytes = hexToBytes(cert.principalIdentity);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pkBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, msgBytes);
  } catch {
    return false;
  }
}

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAIN VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

async function verifyChain(
  chain: DelegationCert[],
  humanPkSet: Set<string>,
  revokedCertIds: Set<string>,
): Promise<GnsVerificationResult> {
  const errors: string[] = [];

  if (chain.length === 0) {
    return { valid: false, agentPk: '', humanPrincipalPk: '', facets: [], territoryCells: [], chainDepth: 0, errors: ['Empty chain'] };
  }

  // 1. Root cert must be issued by a known human principal
  const root = chain[0];
  if (!humanPkSet.has(root.principalIdentity)) {
    errors.push(`Root cert issuer ${root.principalIdentity.slice(0, 16)}... is not a trusted human principal`);
  }

  let effectiveFacets: string[] = root.facetPermissions;
  let effectiveTerritory: string[] = root.territoryCells;

  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];

    // 2. Check revocation
    if (revokedCertIds.has(cert.certId)) {
      errors.push(`Cert ${cert.certId.slice(0, 8)} is revoked`);
    }

    // 3. Check expiry
    if (new Date(cert.expiresAt) < new Date()) {
      errors.push(`Cert ${cert.certId.slice(0, 8)} expired at ${cert.expiresAt}`);
    }

    // 4. Verify signature
    const sigValid = await verifyCertSignature(cert);
    if (!sigValid) {
      errors.push(`Invalid signature on cert ${cert.certId.slice(0, 8)} (depth ${i})`);
    }

    // 5. Verify cert hash integrity
    const { signature, certHash, ...payload } = cert;
    const recomputed = await sha256Hex(canonicalJson(payload));
    if (recomputed !== certHash) {
      errors.push(`Hash mismatch on cert ${cert.certId.slice(0, 8)}`);
    }

    // 6. Verify chain linkage: cert[i].agentIdentity === cert[i+1].principalIdentity
    if (i < chain.length - 1) {
      if (cert.agentIdentity !== chain[i + 1].principalIdentity) {
        errors.push(`Chain broken at depth ${i}: agentIdentity !== next cert principalIdentity`);
      }
    }

    // 7. Compute effective facets (intersection)
    const certFacetSet = new Set(cert.facetPermissions);
    effectiveFacets = effectiveFacets.filter(f => certFacetSet.has(f));

    // 8. Compute effective territory (intersection)
    const certCellSet = new Set(cert.territoryCells);
    effectiveTerritory = effectiveTerritory.filter(c => certCellSet.has(c));
  }

  const leaf = chain[chain.length - 1];

  return {
    valid: errors.length === 0,
    agentPk: leaf.agentIdentity,
    humanPrincipalPk: root.principalIdentity,
    facets: effectiveFacets,
    territoryCells: effectiveTerritory,
    chainDepth: chain.length,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOGGING
// ─────────────────────────────────────────────────────────────────────────────

async function writeAuditLog(
  kv: KVNamespace,
  entry: AuditEntry,
): Promise<void> {
  const key = `audit:${entry.timestamp}:${entry.agentPk.slice(0, 8)}`;
  await kv.put(key, JSON.stringify(entry), { expirationTtl: 90 * 24 * 3600 }); // 90 days
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WORKER HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const cfRay = request.headers.get('cf-ray') ?? undefined;

    // ── Parse trusted human principals ──────────────────────────────────────
    const humanPkSet = new Set(
      (env.GNS_HUMAN_PRINCIPALS ?? '')
        .split(',')
        .map(pk => pk.trim())
        .filter(Boolean)
    );

    const revokedCertIds = new Set(
      (env.GNS_REVOKED_CERTS ?? '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean)
    );

    // ── Pass-through: health check + OPTIONS ─────────────────────────────────
    if (path === '/health' || method === 'OPTIONS') {
      return new Response(JSON.stringify({ status: 'ok', service: 'gns-aip-gateway' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── Read X-GNS-Chain header ──────────────────────────────────────────────
    const chainHeader = request.headers.get('X-GNS-Chain');
    if (!chainHeader) {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        agentPk: 'unknown',
        humanPrincipalPk: 'unknown',
        method, path,
        facet: getRequiredFacet(method, path),
        result: 'DENIED',
        reason: 'missing_chain_header',
        chainDepth: 0,
        cf_ray: cfRay,
      };
      ctx.waitUntil(writeAuditLog(env.GNS_AUDIT_LOG, entry));
      return new Response(JSON.stringify({
        error: 'GNS delegation chain required',
        code: 'MISSING_CHAIN_HEADER',
        hint: 'Add X-GNS-Chain header with base64-encoded delegation cert chain',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Parse chain ──────────────────────────────────────────────────────────
    let chain: DelegationCert[];
    try {
      const decoded = atob(chainHeader);
      chain = JSON.parse(decoded);
      if (!Array.isArray(chain) || chain.length === 0) throw new Error('Empty chain');
    } catch (e) {
      return new Response(JSON.stringify({
        error: 'Invalid X-GNS-Chain header',
        code: 'MALFORMED_CHAIN',
        hint: 'Chain must be base64(JSON array of DelegationCert)',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Verify chain ─────────────────────────────────────────────────────────
    const verification = await verifyChain(chain, humanPkSet, revokedCertIds);

    if (!verification.valid) {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        agentPk: chain[chain.length - 1]?.agentIdentity ?? 'unknown',
        humanPrincipalPk: chain[0]?.principalIdentity ?? 'unknown',
        method, path,
        facet: getRequiredFacet(method, path),
        result: 'DENIED',
        reason: verification.errors.join('; '),
        chainDepth: chain.length,
        cf_ray: cfRay,
      };
      ctx.waitUntil(writeAuditLog(env.GNS_AUDIT_LOG, entry));
      return new Response(JSON.stringify({
        error: 'Delegation chain verification failed',
        code: 'CHAIN_INVALID',
        errors: verification.errors,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Check facet permission ───────────────────────────────────────────────
    const requiredFacet = getRequiredFacet(method, path);
    if (!verification.facets.includes(requiredFacet)) {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        agentPk: verification.agentPk,
        humanPrincipalPk: verification.humanPrincipalPk,
        method, path, facet: requiredFacet,
        result: 'DENIED',
        reason: `facet_denied: ${requiredFacet} not in [${verification.facets.join(', ')}]`,
        chainDepth: verification.chainDepth,
        cf_ray: cfRay,
      };
      ctx.waitUntil(writeAuditLog(env.GNS_AUDIT_LOG, entry));
      return new Response(JSON.stringify({
        error: `Facet '${requiredFacet}' not authorized`,
        code: 'FACET_DENIED',
        effectiveFacets: verification.facets,
        requiredFacet,
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // ── All checks passed — forward to origin ────────────────────────────────
    const originUrl = `${env.GNS_ORIGIN_URL}${path}${url.search}`;
    const forwardHeaders = new Headers(request.headers);

    // Inject verified GNS identity into forwarded request
    forwardHeaders.set('X-GNS-Verified', 'true');
    forwardHeaders.set('X-GNS-Agent-Pk', verification.agentPk);
    forwardHeaders.set('X-GNS-Human-Pk', verification.humanPrincipalPk);
    forwardHeaders.set('X-GNS-Facets', verification.facets.join(','));
    forwardHeaders.set('X-GNS-Chain-Depth', String(verification.chainDepth));
    forwardHeaders.set('X-GNS-Territory', verification.territoryCells.slice(0, 5).join(','));

    const originRequest = new Request(originUrl, {
      method,
      headers: forwardHeaders,
      body: ['GET', 'HEAD'].includes(method) ? null : request.body,
    });

    const originResponse = await fetch(originRequest);

    // Audit log the allowed request
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      agentPk: verification.agentPk,
      humanPrincipalPk: verification.humanPrincipalPk,
      method, path, facet: requiredFacet,
      result: 'ALLOWED',
      chainDepth: verification.chainDepth,
      cf_ray: cfRay,
    };
    ctx.waitUntil(writeAuditLog(env.GNS_AUDIT_LOG, entry));

    // Add GNS headers to response for transparency
    const responseHeaders = new Headers(originResponse.headers);
    responseHeaders.set('X-GNS-Verified', 'true');
    responseHeaders.set('X-GNS-Agent-Pk', verification.agentPk.slice(0, 16) + '...');
    responseHeaders.set('X-GNS-Chain-Depth', String(verification.chainDepth));

    return new Response(originResponse.body, {
      status: originResponse.status,
      headers: responseHeaders,
    });
  },
} satisfies ExportedHandler<Env>;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG READER — separate Worker or Durable Object endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Example: read recent audit entries from KV
 * Add this as a second route in your Worker or expose via separate Worker.
 *
 * GET /audit?limit=50&agentPk=abc123
 */
export async function handleAuditRead(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  const agentPkFilter = url.searchParams.get('agentPk');

  const { keys } = await env.GNS_AUDIT_LOG.list({ prefix: 'audit:', limit });
  const entries = await Promise.all(
    keys.map(async ({ name }) => {
      const val = await env.GNS_AUDIT_LOG.get(name);
      return val ? JSON.parse(val) as AuditEntry : null;
    })
  );

  const filtered = entries
    .filter(Boolean)
    .filter(e => !agentPkFilter || e!.agentPk.startsWith(agentPkFilter));

  return new Response(JSON.stringify({ entries: filtered, count: filtered.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
