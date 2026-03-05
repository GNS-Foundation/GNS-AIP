/**
 * @gns-aip/cyberark — Integration Test Suite
 * Tests all four integration modes:
 *   1. GNS as Conjur Authenticator
 *   2. OIDC Bridge (policy generation)
 *   3. Policy generation from delegation cert
 *   4. Hybrid HITL + Conjur secrets
 */

import { createGnsConjurClient, GnsConjurPolicyGenerator, GnsConjurOidcBridge } from './dist/index.js';
import { generateIdentityKeypair, getH3Cell, buildJurisdiction } from '@gns-aip/sdk';

const pass = (msg) => console.log(`  ✅ ${msg}`);
const fail = (msg, err) => { console.error(`  ❌ ${msg}: ${err}`); process.exit(1); };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { pass(msg); passed++; }
  else { fail(msg, 'assertion failed'); failed++; }
}

async function run() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' @gns-aip/cyberark — CyberArk Conjur Test Suite');
  console.log('══════════════════════════════════════════════════\n');

  // Setup: human keypair + territory
  const humanKeypair = generateIdentityKeypair();
  const romeCell = getH3Cell(41.9028, 12.4964, 7);
  const romeTerritory = buildJurisdiction(romeCell, 2);
  const humanPkHex = Buffer.from(humanKeypair.publicKey).toString('hex');

  // ── 1. PROVISION ──────────────────────────────────────────────────────────
  console.log('1. PROVISION — Agent Identity + Conjur Bootstrap\n');

  const conjur = createGnsConjurClient({
    conjurUrl: 'https://conjur.terna.it',
    account: 'terna',
    humanKeypair,
    verbose: false,
  });

  const agent = await conjur.provisionAgent({
    role: 'scada-monitor',
    territoryCells: romeTerritory,
    facets: ['read', 'telemetry'],
    riskLevel: 'HIGH',
  }).catch(e => fail('provision agent', e));

  assert(agent !== null, 'Agent provisioned');
  assert(agent.agentPk.length === 64, 'Agent has Ed25519 public key (64 hex chars)');
  assert(agent.role === 'scada-monitor', 'Agent role assigned');
  assert(agent.facets.includes('read'), 'Agent has read facet');
  assert(agent.facets.includes('telemetry'), 'Agent has telemetry facet');
  assert(agent.territoryCells.length === romeTerritory.length, 'Agent bound to Rome territory');

  // ── 2. SECRET RETRIEVAL ───────────────────────────────────────────────────
  console.log('\n2. SECRET RETRIEVAL — HITL-Gated Conjur Access\n');

  let escalationFired = false;
  const secret = await agent.retrieveSecret('grid/rome/scada-password', {
    onEscalation: async (req) => {
      escalationFired = true;
      assert(req.escalationId.length > 0, 'Escalation ID present');
      assert(req.agentPk === agent.agentPk, 'Escalation references correct agent');
      assert(req.secretPath === 'grid/rome/scada-password', 'Escalation references correct secret');
      assert(req.humanPrincipalPk === humanPkHex, 'Escalation references human principal');
      assert(req.approvalPayload.length > 0, 'Approval payload for GCRUMBS app present');
    },
  }).catch(e => fail('retrieve secret', e));

  assert(typeof secret === 'string', 'Secret retrieved');
  assert(escalationFired, 'HITL escalation fired for HIGH risk + read facet');

  // Non-escalating retrieval (second call, facet already authorized)
  const secret2 = await agent.retrieveSecret('grid/rome/readonly-token').catch(e => fail('second retrieve', e));
  assert(typeof secret2 === 'string', 'Second secret retrieved');

  // ── 3. FACET INFERENCE ────────────────────────────────────────────────────
  console.log('\n3. FACET INFERENCE — Path-Based Facet Detection\n');

  // Use a financial agent to test facet inference
  const financialAgent = await conjur.provisionAgent({
    role: 'payment-processor',
    territoryCells: romeTerritory.slice(0, 5),
    facets: ['financial'],
    riskLevel: 'CRITICAL',
  }).catch(e => fail('provision financial agent', e));

  let financialEscalation = false;
  await financialAgent.retrieveSecret('finance/swift-credentials', {
    onEscalation: async () => { financialEscalation = true; },
  }).catch(e => fail('financial secret retrieve', e));

  assert(financialEscalation, 'Financial path triggers escalation on CRITICAL policy');

  // ── 4. POLICY GENERATION ──────────────────────────────────────────────────
  console.log('\n4. POLICY GENERATION — Delegation Cert → Conjur YAML\n');

  const policy = agent.getConjurPolicy({ hostPrefix: 'agents/gns' });

  assert(policy.yaml.includes('!host'), 'Policy YAML has host definition');
  assert(policy.yaml.includes('!layer'), 'Policy YAML has layer definitions');
  assert(policy.yaml.includes('gns/cert-id'), 'Policy YAML has GNS cert annotation');
  assert(policy.yaml.includes('gns/human-principal'), 'Policy YAML has human principal annotation');
  assert(policy.yaml.includes('gns/facets'), 'Policy YAML has facets annotation');
  assert(policy.hostId.startsWith('agents/gns/'), 'Host ID has correct prefix');
  assert(policy.layers.length > 0, 'Territory layers generated');
  assert(policy.variables.length > 0, 'Variable permissions generated');
  assert(policy.loadCommand.includes('conjur policy load'), 'Load command generated');

  console.log(`  ℹ️  Sample policy (first 400 chars):\n${policy.yaml.slice(0, 400)}...`);

  // ── 5. CHAIN HEADER ───────────────────────────────────────────────────────
  console.log('\n5. CHAIN HEADER — X-GNS-Chain for HTTP Requests\n');

  const header = agent.getChainHeader();
  const decoded = JSON.parse(Buffer.from(header, 'base64').toString());

  assert(typeof header === 'string', 'Chain header is base64 string');
  assert(decoded.agentPk === agent.agentPk, 'Header contains agent PK');
  assert(decoded.role === 'scada-monitor', 'Header contains role');
  assert(decoded.humanPrincipalPk === humanPkHex, 'Header contains human principal');
  assert(Array.isArray(decoded.facets), 'Header contains facets');
  assert(Array.isArray(decoded.territoryCells), 'Header contains territory cells');

  // ── 6. COMPLIANCE REPORT ─────────────────────────────────────────────────
  console.log('\n6. COMPLIANCE — EU AI Act Audit Trail\n');

  const report = agent.getComplianceReport();

  assert(report.agentPk === agent.agentPk, 'Report references correct agent');
  assert(report.role === 'scada-monitor', 'Report references correct role');
  assert(report.humanPrincipalPk === humanPkHex, 'Report references human principal');
  assert(typeof report.trustScore === 'number', 'Trust score computed');
  assert(report.breadcrumbCount >= 2, 'Breadcrumbs recorded (one per operation)');
  assert(report.operationCount >= 2, 'Operations logged');
  assert(report.art13_transparency === true, 'EU AI Act Art 13 (transparency): audit trail present');
  assert(report.art14_humanOversight === true, 'EU AI Act Art 14 (human oversight): HITL registered');
  assert(report.art17_riskManagement === true, 'EU AI Act Art 17 (risk management): risk level set');
  assert(report.art26_responsibilities === true, 'EU AI Act Art 26 (responsibilities): human principal set');

  const auditLog = agent.getAuditLog();
  assert(auditLog.length >= 2, `Audit log has ${auditLog.length} entries`);
  assert(auditLog[0].operation === 'RETRIEVE_SECRET', 'First entry is RETRIEVE_SECRET');
  assert(auditLog[0].breadcrumbHash.length > 0, 'Audit entries have breadcrumb hash');
  assert(auditLog[0].delegationCertId.length > 0, 'Audit entries have delegation cert ID');

  // ── 7. OIDC BRIDGE ────────────────────────────────────────────────────────
  console.log('\n7. OIDC BRIDGE — GNS as Conjur OIDC Identity Provider\n');

  const oidcPolicy = GnsConjurOidcBridge.generateOidcAuthenticatorPolicy('terna');
  assert(oidcPolicy.includes('authn-oidc/gns'), 'OIDC policy has GNS authenticator ID');
  assert(oidcPolicy.includes('provider-uri'), 'OIDC policy has provider-uri variable');
  assert(oidcPolicy.includes('id-token-user-property'), 'OIDC policy has user property mapping');

  const claimMap = GnsConjurOidcBridge.mapGnsClaimsToConjurAnnotations({
    sub: humanPkHex,
    gns_id: 'camilo@rome',
    gns_trust_tier: 'NAVIGATOR',
    gns_breadcrumb_count: 340,
    gns_humanity_proof_valid: true,
    gns_territory: romeCell,
    gns_facets: 'read,telemetry',
  });

  assert(claimMap['gns/identity'] === humanPkHex, 'Identity claim mapped');
  assert(claimMap['gns/handle'] === 'camilo@rome', 'Handle claim mapped');
  assert(claimMap['gns/trust-tier'] === 'NAVIGATOR', 'Trust tier mapped');
  assert(claimMap['gns/breadcrumb-count'] === '340', 'Breadcrumb count mapped');
  assert(claimMap['gns/humanity-verified'] === 'true', 'Humanity proof mapped');

  // ── 8. REVOCATION ─────────────────────────────────────────────────────────
  console.log('\n8. REVOCATION — Agent Lifecycle Management\n');

  const agentsBefore = conjur.getAgents().length;
  await conjur.revokeAgent('scada-monitor').catch(e => fail('revoke agent', e));
  const agentsAfter = conjur.getAgents().length;

  assert(agentsAfter === agentsBefore - 1, 'Agent removed from active registry');

  // ── RESULTS ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
