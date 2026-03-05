/**
 * GNS-AIP SDK Phase 1 — Test Suite
 * Run: node test-phase1.js
 *
 * Tests:
 *   DelegationChain  — 18 assertions
 *   HitlEngine       — 16 assertions
 *   GnsOidcProvider  — 12 assertions
 *   Total            — 46 assertions
 */

import nacl from 'tweetnacl';
import { DelegationChain, verifyDelegationChain, isCertAuthorized } from './dist/delegation-chain.js';
import { HitlEngine } from './dist/hitl.js';
import { GnsOidcProvider, buildOktaPatchCommands } from './dist/oidc.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`);
}

// ─────────────────────────────────────────────────────────────
// DELEGATION CHAIN TESTS
// ─────────────────────────────────────────────────────────────

section('DelegationChain');

const humanKp = nacl.sign.keyPair();
const managerKp = nacl.sign.keyPair();
const workerKp = nacl.sign.keyPair();
const intruderKp = nacl.sign.keyPair();
const chain = new DelegationChain();

const territory = ['872a100dfffffff', '872a100cfffffff', '872a100bfffffff'];
const subTerritory = ['872a100dfffffff'];

// 1. Create root cert
let rootCert;
try {
  rootCert = chain.createRootCert(humanKp, managerKp.publicKey, {
    territoryCells: territory,
    facets: ['read', 'write', 'execute', 'financial'],
    riskLevel: 'HIGH',
    ttlSeconds: 3600,
    maxSubDelegationDepth: 2,
    delegatableFacets: ['read', 'execute'],
    purpose: 'Terna grid monitoring — Milan zone',
  });
  assert(true, 'Root cert created');
} catch (e) {
  assert(false, `Root cert creation failed: ${e.message}`);
}

assert(rootCert.payload.depth === 0, 'Root cert depth = 0');
assert(rootCert.payload.previousCertHash === null, 'Root cert has no parent hash');
assert(rootCert.payload.humanPrincipalPk === rootCert.payload.issuerPk, 'humanPrincipalPk === issuerPk at root');
assert(rootCert.payload.subDelegation.maxSubDelegationDepth === 2, 'maxSubDelegationDepth = 2');
assert(rootCert.payload.subDelegation.requireHitlForSubDelegation === true, 'HIGH risk requires HITL for sub-delegation');

// 2. Verify root cert alone
const rootVerify = chain.verify(rootCert);
assert(rootVerify.valid, 'Root cert verifies cleanly');
assert(rootVerify.depth === 0, 'Verify reports depth 0');
assert(rootVerify.chain.length === 1, 'Chain length = 1 for root');

// 3. Create child cert (manager → worker)
let childCert;
try {
  childCert = chain.createChildCert(rootCert, managerKp, workerKp.publicKey, {
    territoryCells: subTerritory,
    facets: ['read', 'execute'],
    riskLevel: 'MEDIUM',
    ttlSeconds: 1800,
    maxSubDelegationDepth: 0,
    purpose: 'Read-only sensor telemetry — substation 14',
  });
  assert(true, 'Child cert created');
} catch (e) {
  assert(false, `Child cert creation failed: ${e.message}`);
}

assert(childCert.payload.depth === 1, 'Child cert depth = 1');
assert(childCert.payload.previousCertHash === rootCert.certHash, 'Child points to root hash');
assert(childCert.payload.humanPrincipalPk === rootCert.payload.humanPrincipalPk, 'humanPrincipalPk propagates through chain');
assert(childCert.payload.chainId === rootCert.payload.chainId, 'chainId is consistent');

// 4. Verify full chain
const childVerify = chain.verify(childCert);
assert(childVerify.valid, 'Full 2-cert chain verifies');
assert(childVerify.depth === 1, 'Depth reported as 1');
assert(childVerify.chain.length === 2, 'Chain array has 2 certs');
assert(childVerify.effectiveFacets.sort().join(',') === 'execute,read', 'Effective facets = intersection (read, execute)');
assert(childVerify.effectiveTerritory.join(',') === subTerritory.join(','), 'Effective territory = intersection (sub-territory)');

// 5. Block invalid sub-delegation
let threw = false;
try {
  chain.createChildCert(childCert, workerKp, intruderKp.publicKey, {
    territoryCells: subTerritory,
    facets: ['read'],
    riskLevel: 'LOW',
    ttlSeconds: 300,
    purpose: 'Should fail — maxSubDelegationDepth=0',
  });
} catch { threw = true; }
assert(threw, 'Sub-delegation blocked when maxSubDelegationDepth=0');

// 6. Block facet escalation attempt
threw = false;
try {
  chain.createChildCert(rootCert, managerKp, workerKp.publicKey, {
    territoryCells: subTerritory,
    facets: ['financial'],  // financial not in delegatableFacets
    riskLevel: 'HIGH',
    ttlSeconds: 300,
    purpose: 'Should fail — financial not delegatable',
  });
} catch { threw = true; }
assert(threw, 'Facet escalation outside delegatable set blocked');

// 7. isCertAuthorized helper
const authorized = isCertAuthorized(childCert, 'read', '872a100dfffffff');
assert(authorized, 'isCertAuthorized returns true for valid facet + territory');
const notAuth = isCertAuthorized(childCert, 'financial', '872a100dfffffff');
assert(!notAuth, 'isCertAuthorized returns false for facet not in effective set');

// ─────────────────────────────────────────────────────────────
// HITL ENGINE TESTS
// ─────────────────────────────────────────────────────────────

section('HitlEngine (Human-in-the-Loop)');

const hitl = new HitlEngine();
const agentPk = 'agent_' + Buffer.from(nacl.randomBytes(8)).toString('hex');
const humanPk = 'human_' + Buffer.from(nacl.randomBytes(8)).toString('hex');

// 1. Register agent
hitl.registerAgent(agentPk, 'HIGH');
assert(true, 'Agent registered with HIGH policy');

// 2. First operation on any facet always escalates
const firstCheck = hitl.checkOperation(agentPk, 'read', 'Read grid sensor data', humanPk);
assert(!firstCheck.authorized, 'First operation on new facet requires escalation');
assert(firstCheck.requiresEscalation, 'requiresEscalation = true on first op');
assert(firstCheck.reason === 'FIRST_OP', 'Reason = FIRST_OP');
assert(!!firstCheck.escalationRequest?.escalationId, 'escalationRequest has escalationId');

// 3. Resolve escalation with signed token
const escalationId = firstCheck.escalationRequest.escalationId;
const token = HitlEngine.createAuthorizationToken(
  escalationId, agentPk, 'read', humanKp, 20, 600
);
hitl.resolveEscalation(escalationId, token, humanKp.publicKey);
assert(true, 'Escalation resolved with valid human signature');

// 4. After resolution, operations proceed
const afterResolve = hitl.checkOperation(agentPk, 'read', 'Read grid sensor data #2', humanPk);
assert(afterResolve.authorized, 'Operations authorized after escalation resolved');
assert(!afterResolve.requiresEscalation, 'requiresEscalation = false after auth');

// 5. Always-escalate facets never auto-authorize (HIGH policy: financial always escalates)
const financialCheck = hitl.checkOperation(agentPk, 'financial', 'Send 1000 EUR payment', humanPk);
assert(!financialCheck.authorized, 'Financial facet always escalates on HIGH policy');
assert(financialCheck.reason === 'ALWAYS_ESCALATE_FACET', 'Reason = ALWAYS_ESCALATE_FACET');

// 6. Resolve financial escalation
const finEscId = financialCheck.escalationRequest.escalationId;
const finToken = HitlEngine.createAuthorizationToken(finEscId, agentPk, 'financial', humanKp, 1, 120);
hitl.resolveEscalation(finEscId, finToken, humanKp.publicKey);
assert(true, 'Financial escalation resolved');

// 7. LOW-risk agent has permissive policy
const lowRiskPk = 'low_' + Buffer.from(nacl.randomBytes(8)).toString('hex');
hitl.registerAgent(lowRiskPk, 'LOW');
const lowFirstCheck = hitl.checkOperation(lowRiskPk, 'read', 'Read telemetry', humanPk);
assert(!lowFirstCheck.authorized, 'LOW-risk still requires first-op auth');

// 8. CRITICAL policy: every operation escalates
const critPk = 'crit_' + Buffer.from(nacl.randomBytes(8)).toString('hex');
hitl.registerAgent(critPk, 'CRITICAL');
const critCheck = hitl.checkOperation(critPk, 'read', 'Any read op', humanPk);
assert(!critCheck.authorized, 'CRITICAL policy escalates even read ops');
// CRITICAL read: no prior auth → FIRST_OP trigger (not in alwaysEscalateFacets, but still blocked)
assert(critCheck.reason === 'FIRST_OP' || critCheck.reason === 'ALWAYS_ESCALATE_FACET',
  `CRITICAL read escalated (reason=${critCheck.reason})`);

// 9. Compliance report generation
const resolvedAgent = agentPk;
const report = hitl.generateComplianceReport(resolvedAgent);
assert(report.euAiActCompliance.article14_humanOversight, 'Art 14 compliant after proper HITL usage');
assert(report.euAiActCompliance.article17_riskManagement, 'Art 17 compliant — policy registered');
assert(report.euAiActCompliance.article13_transparency, 'Art 13 compliant — audit trail present');
assert(report.euAiActCompliance.overallCompliant, 'Overall EU AI Act compliant');

// 10. Audit log
const auditLog = hitl.getAuditLog(resolvedAgent);
assert(auditLog.length >= 3, `Audit log has entries (found ${auditLog.length})`);

// ─────────────────────────────────────────────────────────────
// OIDC PROVIDER TESTS
// ─────────────────────────────────────────────────────────────

section('GnsOidcProvider');

const provider = new GnsOidcProvider({ issuer: 'https://id.gns.foundation' });

// Register a test client (Okta)
provider.registerClient({
  client_id: 'okta-test-client',
  client_name: 'Okta Integration Test',
  redirect_uris: ['https://your-okta-org.okta.com/oauth2/v1/authorize/callback'],
  gns_required_scopes: ['openid', 'profile', 'gns:trust', 'gns:humanity'],
  min_trust_tier: 'EXPLORER',
  allow_agent_subjects: false,
  require_territory: false,
});

// 1. Issue human id_token
const humanSubject = {
  publicKeyHex: Buffer.from(humanKp.publicKey).toString('hex'),
  handle: '@camiloayerbe',
  trustScore: 72,
  breadcrumbCount: 340,
  humanityProofHash: 'abc123def456',
  lastBreadcrumbAt: new Date().toISOString(),
  subjectType: 'human',
};

const idToken = provider.issueIdToken(humanSubject, {
  clientId: 'okta-test-client',
  scopes: ['openid', 'profile', 'gns:trust', 'gns:humanity'],
  nonce: 'test-nonce-123',
});
assert(typeof idToken === 'string' && idToken.split('.').length === 3, 'id_token is valid JWT format');

// 2. Verify the token
let decoded;
try {
  decoded = provider.verifyIdToken(idToken);
  assert(true, 'id_token signature verifies');
} catch (e) {
  assert(false, `Verification failed: ${e.message}`);
}

// 3. Check standard claims
assert(decoded.iss === 'https://id.gns.foundation', 'iss claim correct');
assert(decoded.sub === humanSubject.publicKeyHex, 'sub = Ed25519 pk hex');
assert(decoded.aud === 'okta-test-client', 'aud = client_id');

// 4. Check GNS custom claims
assert(decoded.gns_handle === '@camiloayerbe', 'gns_handle present');
assert(decoded.gns_trust_tier === 'NAVIGATOR', 'gns_trust_tier = NAVIGATOR (340 BC)');
assert(decoded.gns_breadcrumb_count === 340, 'gns_breadcrumb_count correct');
assert(decoded.gns_humanity_proof_valid === true, 'gns_humanity_proof_valid = true (recent breadcrumb)');
assert(decoded.gns_subject_type === 'human', 'gns_subject_type = human');

// 5. Discovery document
const discovery = provider.getDiscoveryDocument();
assert(discovery.id_token_signing_alg_values_supported.includes('EdDSA'), 'Discovery: EdDSA signing alg');
assert(discovery.claims_supported.includes('gns_humanity_proof_valid'), 'Discovery: GNS claims listed');

// 6. JWKS document
const jwks = provider.getJwks();
assert(jwks.keys[0].crv === 'Ed25519', 'JWKS: Ed25519 curve');
assert(jwks.keys[0].kty === 'OKP', 'JWKS: OKP key type');

// 7. Okta patch commands
const gnsClaimsForOkta = {
  gns_pk: humanSubject.publicKeyHex,
  gns_handle: '@camiloayerbe',
  gns_trust_score: 72,
  gns_trust_tier: 'NAVIGATOR',
  gns_breadcrumb_count: 340,
  gns_humanity_proof: 'abc123def456',
  gns_humanity_proof_valid: true,
  gns_subject_type: 'human',
  gns_agent_id: null,
  gns_delegation_chain: null,
  gns_territory: null,
  gns_last_seen: new Date().toISOString(),
  gns_protocol_version: '2.0',
};
const patches = buildOktaPatchCommands(gnsClaimsForOkta);
assert(patches.length >= 6, `Okta patch commands generated (${patches.length} commands)`);
assert(patches.every(p => p.op === 'add' && p.path.startsWith('/claims/')), 'All patches are add ops on /claims/');

// ─────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(55));
console.log(`  GNS-AIP Phase 1 — ${passed + failed} tests`);
console.log(`  ✓ ${passed} passed    ✗ ${failed} failed`);
console.log('═'.repeat(55));

if (failed > 0) process.exit(1);
