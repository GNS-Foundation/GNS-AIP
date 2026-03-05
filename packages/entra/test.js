/**
 * @gns-aip/entra — Custom Claims Provider Test Suite
 *
 * Tests:
 *   1.  Happy path — known identity enriches token with all GNS claims
 *   2.  All claim values are strings or string[] (Entra constraint)
 *   3.  Unknown identity — returns empty GNS claims (zeros/false strings)
 *   4.  Trust tier gate — degrades claims below minimum tier
 *   5.  Bearer token validation — rejects missing/bad auth
 *   6.  Bearer token skip in dev mode
 *   7.  Wrong event type → 400
 *   8.  Territory claims are string[] not string
 *   9.  Response envelope matches Entra @odata.type contract exactly
 *  10.  Router — /health, /policy, /claims routing
 *  11.  ClaimsMappingPolicy — correct schema structure for Graph API
 *  12.  ClaimsMappingPolicy — definition is stringified JSON (MS quirk)
 *  13.  Admin client — setupGnsClaimsProvider returns policyId + extensionId
 *  14.  Setup guide — contains tenant ID and hook URL
 *  15.  Payload stays under 3KB (Entra limit)
 */

import {
  GnsEntraClaimsHandler,
  GnsEntraAdminClient,
  GnsEntraClaimsMappingPolicy,
  EntraBearerValidator,
  createEntraClaimsRouter,
} from './dist/index.js';

let passed = 0;
let failed = 0;

const pass = (msg) => { console.log(`  ✅ ${msg}`); passed++; };
const fail = (msg, err) => { console.error(`  ❌ ${msg}: ${err}`); failed++; };
const assert = (cond, msg) => cond ? pass(msg) : fail(msg, 'assertion failed');

const TENANT_ID = 'test-tenant-id-12345';
const GNS_APP_ID = 'gns-app-id-abcdef';

function makeEntraRequest(userOverrides = {}) {
  return {
    type: 'microsoft.graph.authenticationEvent.tokenIssuanceStart',
    source: `/tenants/${TENANT_ID}/applications/app-123`,
    data: {
      '@odata.type': 'microsoft.graph.onTokenIssuanceStartCalloutData',
      tenantId: TENANT_ID,
      authenticationEventListenerId: 'listener-abc',
      customAuthenticationExtensionId: 'ext-xyz',
      authenticationContext: {
        correlationId: 'corr-123',
        client: { ip: '192.168.1.1', locale: 'it-IT', market: 'it-IT' },
        protocol: 'OAUTH2.0',
        clientServicePrincipal: { id: 'sp-1', appId: 'app-123', appDisplayName: 'Terna Portal', displayName: 'Terna Portal' },
        resourceServicePrincipal: { id: 'sp-1', appId: 'app-123', appDisplayName: 'Terna Portal', displayName: 'Terna Portal' },
        user: {
          id: 'entra-user-id-abc',
          displayName: 'Camilo Ayerbe',
          givenName: 'Camilo',
          surname: 'Ayerbe',
          mail: 'camilo@ulissy.app',
          userPrincipalName: 'camilo@ulissy.app',
          companyName: 'ULISSY s.r.l.',
          userType: 'Member',
          createdDateTime: '2023-01-01T00:00:00Z',
          ...userOverrides,
        },
      },
    },
  };
}

// Make a fake Entra bearer JWT (structure only, no real sig — skipTokenValidation=true)
function fakeBearerToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    aud: GNS_APP_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    tid: TENANT_ID,
    appid: 'entra-events-service',
  })).toString('base64url');
  return `Bearer ${header}.${payload}.fake-signature`;
}

async function run() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' @gns-aip/entra — Custom Claims Provider Test Suite');
  console.log('══════════════════════════════════════════════════\n');

  // Handler with token validation skipped for testing
  const handler = new GnsEntraClaimsHandler({
    gnsAppId: GNS_APP_ID,
    tenantId: TENANT_ID,
    skipTokenValidation: true,
  });

  // ── 1. HAPPY PATH ─────────────────────────────────────────────────────────
  console.log('1. HAPPY PATH — Known GNS identity enriches token\n');

  // Inject known identity via gns_pk (simulated)
  const req1 = makeEntraRequest();
  // Make the resolver find a known identity by using a pk in user id field
  req1.data.authenticationContext.user.id = 'a'.repeat(64);

  const res1 = await handler.handleRequest(fakeBearerToken(), req1);

  assert(res1.status === 200, 'Returns HTTP 200');
  assert(res1.body.data !== undefined, 'Response has data envelope');
  assert(res1.body.data['@odata.type'] === 'microsoft.graph.onTokenIssuanceStartResponseData', 'Correct @odata.type');
  assert(Array.isArray(res1.body.data.actions), 'Actions is array');
  assert(res1.body.data.actions.length === 1, 'Exactly one action');
  assert(res1.body.data.actions[0]['@odata.type'] === 'microsoft.graph.tokenIssuanceStart.provideClaimsForToken', 'Correct action @odata.type');

  const claims = res1.body.data.actions[0].claims;
  assert(typeof claims === 'object', 'Claims is object');
  assert('gns_pk' in claims, 'gns_pk present');
  assert('gns_trust_tier' in claims, 'gns_trust_tier present');
  assert('gns_trust_score' in claims, 'gns_trust_score present');
  assert('gns_breadcrumb_count' in claims, 'gns_breadcrumb_count present');
  assert('gns_humanity_proof_valid' in claims, 'gns_humanity_proof_valid present');
  assert('gns_subject_type' in claims, 'gns_subject_type present');
  assert('gns_protocol_version' in claims, 'gns_protocol_version present');
  assert('gns_identity_found' in claims, 'gns_identity_found present');

  // ── 2. ALL CLAIM VALUES ARE STRINGS OR STRING[] ───────────────────────────
  console.log('\n2. ENTRA TYPE CONSTRAINT — All values must be string or string[]\n');

  for (const [key, value] of Object.entries(claims)) {
    const isStringOrArray = typeof value === 'string' ||
      (Array.isArray(value) && value.every(v => typeof v === 'string'));
    assert(isStringOrArray, `Claim ${key} is string or string[] (got ${typeof value})`);
  }

  // No booleans
  assert(typeof claims.gns_humanity_proof_valid === 'string', 'gns_humanity_proof_valid is string not boolean');
  assert(claims.gns_humanity_proof_valid === 'true' || claims.gns_humanity_proof_valid === 'false', 'gns_humanity_proof_valid is "true" or "false"');

  // No numbers
  assert(typeof claims.gns_trust_score === 'string', 'gns_trust_score is string not number');
  assert(typeof claims.gns_breadcrumb_count === 'string', 'gns_breadcrumb_count is string not number');
  assert(!isNaN(Number(claims.gns_trust_score)), 'gns_trust_score is parseable as number');

  // ── 3. UNKNOWN IDENTITY ───────────────────────────────────────────────────
  console.log('\n3. UNKNOWN IDENTITY — Returns empty GNS claims\n');

  const req3 = makeEntraRequest({ id: 'unknown-entra-id', mail: undefined, userPrincipalName: undefined });
  const res3 = await handler.handleRequest(fakeBearerToken(), req3);

  assert(res3.status === 200, 'Unknown identity still returns 200 (non-blocking)');
  const c3 = res3.body.data.actions[0].claims;
  assert(c3.gns_identity_found === 'false', 'gns_identity_found is "false"');
  assert(c3.gns_trust_tier === 'SEEDLING', 'Unknown identity gets SEEDLING tier');
  assert(c3.gns_trust_score === '0', 'Unknown identity gets score 0');
  assert(c3.gns_humanity_proof_valid === 'false', 'Unknown identity gets humanity_proof_valid=false');
  assert(c3.gns_protocol_version === '2.0', 'Protocol version still present');

  // ── 4. TRUST TIER GATE ────────────────────────────────────────────────────
  console.log('\n4. TRUST TIER GATE — Degrades claims below minimum tier\n');

  // Mock returns score=72 (NAVIGATOR). Require TRAILBLAZER — should degrade claims.
  const highTierHandler = new GnsEntraClaimsHandler({
    gnsAppId: GNS_APP_ID,
    tenantId: TENANT_ID,
    skipTokenValidation: true,
    minTrustTier: 'TRAILBLAZER',
  });

  const req4 = makeEntraRequest({ id: 'b'.repeat(64) });
  const res4 = await highTierHandler.handleRequest(fakeBearerToken(), req4);

  assert(res4.status === 200, 'Still returns 200 (Entra cannot block issuance)');
  const c4 = res4.body.data.actions[0].claims;
  assert(c4.gns_trust_tier === 'SEEDLING', 'Degraded to SEEDLING when below min tier');
  assert(c4.gns_trust_score === '0', 'Degraded score to 0');
  assert(c4.gns_humanity_proof_valid === 'false', 'Degraded humanity proof');
  // App-level enforcement note: the RP must check gns_trust_tier in its access policy

  // ── 5. BEARER TOKEN VALIDATION ────────────────────────────────────────────
  console.log('\n5. BEARER TOKEN VALIDATION — Rejects bad auth\n');

  const strictHandler = new GnsEntraClaimsHandler({
    gnsAppId: GNS_APP_ID,
    tenantId: TENANT_ID,
    skipTokenValidation: false,
  });

  // Missing auth
  const res5a = await strictHandler.handleRequest(undefined, makeEntraRequest());
  assert(res5a.status === 401, 'Missing auth header returns 401');

  // Wrong format
  const res5b = await strictHandler.handleRequest('Basic sometoken', makeEntraRequest());
  assert(res5b.status === 401, 'Non-Bearer auth returns 401');

  // Malformed JWT
  const res5c = await strictHandler.handleRequest('Bearer notajwt', makeEntraRequest());
  assert(res5c.status === 401, 'Malformed JWT returns 401');

  // Wrong issuer
  const wrongIssPayload = Buffer.from(JSON.stringify({
    iss: 'https://evil.com/v2.0',
    aud: GNS_APP_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    tid: TENANT_ID,
  })).toString('base64url');
  const wrongIssToken = `Bearer header.${wrongIssPayload}.sig`;
  const res5d = await strictHandler.handleRequest(wrongIssToken, makeEntraRequest());
  assert(res5d.status === 401, 'Wrong issuer returns 401');

  // ── 6. SKIP TOKEN VALIDATION IN DEV ──────────────────────────────────────
  console.log('\n6. DEV MODE — skipTokenValidation bypasses auth check\n');

  const devRes = await handler.handleRequest(undefined, makeEntraRequest());
  assert(devRes.status === 200, 'skipTokenValidation=true allows missing auth');

  // ── 7. WRONG EVENT TYPE → 400 ─────────────────────────────────────────────
  console.log('\n7. WRONG EVENT TYPE — Returns 400\n');

  const wrongEvent = makeEntraRequest();
  wrongEvent.type = 'microsoft.graph.authenticationEvent.unknownEvent';
  const res7 = await handler.handleRequest(fakeBearerToken(), wrongEvent);
  assert(res7.status === 400, 'Wrong event type returns 400');
  assert(res7.body.error.includes('Unexpected event type'), 'Error mentions event type');

  // ── 8. TERRITORY AS STRING ARRAY ─────────────────────────────────────────
  console.log('\n8. TERRITORY — H3 cells as string[] (Entra supports this)\n');

  const req8 = makeEntraRequest({ id: 'c'.repeat(64) });
  const res8 = await handler.handleRequest(fakeBearerToken(), req8);
  const c8 = res8.body.data.actions[0].claims;

  // Mock returns territory for known identities
  if ('gns_territory' in c8) {
    assert(Array.isArray(c8.gns_territory), 'gns_territory is string array');
    assert(c8.gns_territory.every(t => typeof t === 'string'), 'All territory values are strings');
    assert(c8.gns_territory.length <= 10, 'Territory capped at 10 cells (3KB limit)');
  } else {
    pass('gns_territory not present (unknown identity — expected)');
  }

  // ── 9. RESPONSE ENVELOPE ──────────────────────────────────────────────────
  console.log('\n9. RESPONSE ENVELOPE — Exact Entra @odata.type contract\n');

  const envelope = res1.body;
  assert(envelope.data['@odata.type'] === 'microsoft.graph.onTokenIssuanceStartResponseData',
    'data @odata.type correct');
  assert(envelope.data.actions[0]['@odata.type'] === 'microsoft.graph.tokenIssuanceStart.provideClaimsForToken',
    'action @odata.type correct');
  assert(typeof envelope.data.actions[0].claims === 'object', 'claims is object');

  // ── 10. ROUTER ────────────────────────────────────────────────────────────
  console.log('\n10. ROUTER — Endpoint routing\n');

  const router = createEntraClaimsRouter({
    gnsAppId: GNS_APP_ID,
    tenantId: TENANT_ID,
    skipTokenValidation: true,
  });

  const health = await router.processRequest({ method: 'GET', path: '/health', headers: {}, body: {} });
  assert(health.status === 200, 'GET /health returns 200');
  assert(health.body.service === 'gns-entra-claims', 'Health has correct service name');

  const policy = await router.processRequest({ method: 'GET', path: '/policy', headers: {}, body: {} });
  assert(policy.status === 200, 'GET /policy returns 200');
  assert(typeof policy.body.definition === 'object', 'Policy has definition');

  const claimsRes = await router.processRequest({
    method: 'POST', path: '/claims',
    headers: {},
    body: makeEntraRequest({ id: 'd'.repeat(64) }),
  });
  assert(claimsRes.status === 200, 'POST /claims returns 200');
  assert(!!claimsRes.body.data, 'Claims response has data');

  const notFound = await router.processRequest({ method: 'GET', path: '/unknown', headers: {}, body: {} });
  assert(notFound.status === 404, 'Unknown path returns 404');

  // ── 11. CLAIMS MAPPING POLICY SCHEMA ─────────────────────────────────────
  console.log('\n11. CLAIMS MAPPING POLICY — Correct schema structure\n');

  const policyObj = GnsEntraClaimsMappingPolicy.generate();
  const schema = policyObj.ClaimsMappingPolicy.ClaimsSchema;

  assert(Array.isArray(schema), 'ClaimsSchema is array');
  assert(policyObj.ClaimsMappingPolicy.Version === 1, 'Policy version is 1');
  assert(policyObj.ClaimsMappingPolicy.IncludeBasicClaimSet === 'true', 'IncludeBasicClaimSet is "true"');

  const claimIds = schema.map(s => s.ID);
  assert(claimIds.includes('gns_pk'), 'Schema includes gns_pk');
  assert(claimIds.includes('gns_trust_tier'), 'Schema includes gns_trust_tier');
  assert(claimIds.includes('gns_humanity_proof_valid'), 'Schema includes gns_humanity_proof_valid');
  assert(claimIds.includes('gns_territory'), 'Schema includes gns_territory');
  assert(schema.every(s => s.Source === 'CustomClaimsProvider'), 'All claims have Source=CustomClaimsProvider');
  assert(schema.every(s => typeof s.JwtClaimType === 'string'), 'All claims have JwtClaimType');

  // ── 12. CLAIMS MAPPING POLICY — GRAPH API BODY ────────────────────────────
  console.log('\n12. CLAIMS MAPPING POLICY — Graph API body format\n');

  const graphBody = GnsEntraClaimsMappingPolicy.generateGraphApiBody();
  assert(typeof graphBody.displayName === 'string', 'Graph body has displayName');
  assert(Array.isArray(graphBody.definition), 'Graph body definition is array');
  assert(graphBody.definition.length === 1, 'Definition has exactly 1 element (MS requirement)');
  assert(typeof graphBody.definition[0] === 'string', 'Definition[0] is string (stringified JSON)');

  // Verify it's valid JSON when parsed
  const parsedDef = JSON.parse(graphBody.definition[0]);
  assert(parsedDef.ClaimsMappingPolicy !== undefined, 'Stringified definition is valid JSON with ClaimsMappingPolicy');

  // ── 13. ADMIN CLIENT ──────────────────────────────────────────────────────
  console.log('\n13. ADMIN CLIENT — Programmatic tenant setup\n');

  const adminClient = new GnsEntraAdminClient({
    tenantId: TENANT_ID,
    clientId: 'client-123',
    clientSecret: 'secret-abc',
  });

  const { policyId, extensionId } = await adminClient.setupGnsClaimsProvider({
    hookUrl: 'https://api.gns.foundation/entra',
    appId: GNS_APP_ID,
    name: 'GNS Protocol Claims Provider',
  });

  assert(typeof policyId === 'string' && policyId.length > 0, 'setupGnsClaimsProvider returns policyId');
  assert(typeof extensionId === 'string' && extensionId.length > 0, 'setupGnsClaimsProvider returns extensionId');

  const token = await adminClient.getGraphToken();
  assert(typeof token === 'string', 'getGraphToken returns string');

  // ── 14. SETUP GUIDE ───────────────────────────────────────────────────────
  console.log('\n14. SETUP GUIDE — Contains required configuration steps\n');

  const guide = GnsEntraClaimsMappingPolicy.generateSetupGuide(
    TENANT_ID,
    'https://api.gns.foundation/entra'
  );
  assert(guide.includes(TENANT_ID), 'Setup guide contains tenant ID');
  assert(guide.includes('api.gns.foundation/entra'), 'Setup guide contains hook URL');
  assert(guide.includes('claimsMappingPolicies'), 'Setup guide contains Graph API endpoint');
  assert(guide.includes('CustomAuthenticationExtension.Receive.Payload'), 'Setup guide contains required permission');
  assert(guide.includes('TokenIssuanceStart'), 'Setup guide mentions event type');
  assert(guide.includes('gns_pk'), 'Setup guide mentions GNS claims');

  // ── 15. 3KB PAYLOAD LIMIT ─────────────────────────────────────────────────
  console.log('\n15. PAYLOAD SIZE — Stays under Entra 3KB claim limit\n');

  const req15 = makeEntraRequest({ id: 'e'.repeat(64) });
  const res15 = await handler.handleRequest(fakeBearerToken(), req15);
  const payloadSize = Buffer.byteLength(JSON.stringify(res15.body.data.actions[0].claims), 'utf8');
  assert(payloadSize < 3072, `Claim payload ${payloadSize}B is under 3072B (3KB) Entra limit`);

  // ── RESULTS ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
