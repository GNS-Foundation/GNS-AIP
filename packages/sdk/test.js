import * as sdk from "./dist/index.js";
// =============================================================================
// @gns-aip/sdk — Integration Test
// =============================================================================
// Tests the complete agent lifecycle:
//   1. Provision: Generate agent identity
//   2. Delegate: Human signs delegation certificate
//   3. Operate: Agent creates virtual breadcrumbs
//   4. Verify: Validate signatures and chain integrity
//   5. Score: Calculate compliance score and tier
// =============================================================================



let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${message}`);
  }
}

async function test() {
  console.log('\n══════════════════════════════════════════');
  console.log(' @gns-aip/sdk — Integration Test Suite');
  console.log('══════════════════════════════════════════\n');

  // ─────────────────────────────────────────
  // 1. PROVISION: Generate identities
  // ─────────────────────────────────────────
  console.log('1. PROVISION — Agent Identity Generation\n');

  const agent = sdk.generateAgentIdentity();
  assert(agent.publicKey.length === 64, `Agent public key: ${agent.publicKey.substring(0, 16)}...`);
  assert(agent.secretKey.length === 128, 'Agent secret key: 128 hex chars (64 bytes)');
  assert(agent.gnsId.startsWith('gns_'), `Agent GNS ID: ${agent.gnsId}`);
  assert(agent.stellarAddress.startsWith('G'), `Agent Stellar address: ${agent.stellarAddress.substring(0, 8)}...`);
  assert(agent.type === 'agent', 'Identity type: agent');

  // Restore from secret key
  const restored = sdk.agentIdentityFromSecretKey(agent.secretKey);
  assert(restored.publicKey === agent.publicKey, 'Restored identity matches original');
  assert(restored.stellarAddress === agent.stellarAddress, 'Restored Stellar address matches');

  // Stellar round-trip
  const pkFromStellar = sdk.stellarAddressToPublicKey(agent.stellarAddress);
  assert(pkFromStellar === agent.publicKey, 'Stellar address round-trip: G... → hex → G...');

  // Human identity (the deployer and principal)
  const human = sdk.generateAgentIdentity(); // Same keypair format, different role
  const deployer = sdk.generateAgentIdentity();
  console.log(`  Human principal: ${human.gnsId}`);
  console.log(`  Deployer org:    ${deployer.gnsId}`);

  // Public identity extraction
  const pub = sdk.toPublicIdentity(agent);
  assert(pub.publicKey === agent.publicKey, 'Public identity has correct publicKey');
  assert(pub.secretKey === undefined, 'Public identity excludes secretKey');

  // ─────────────────────────────────────────
  // 2. TERRITORY: H3 Jurisdictional Binding
  // ─────────────────────────────────────────
  console.log('\n2. TERRITORY — H3 Jurisdictional Binding\n');

  // Rome (where Gemelli hospital is)
  const romeCell = sdk.latLngToH3(41.9028, 12.4964, 7);
  assert(typeof romeCell === 'string' && romeCell.length > 0, `Rome H3 cell: ${romeCell}`);

  // Create jurisdiction centered on Rome, 2-ring expansion
  const jurisdiction = sdk.createJurisdictionFromCenter(
    41.9028, 12.4964, 2, ['Rome', 'Italy'], ['IT'], 7
  );
  assert(jurisdiction.cells.length === 19, `Jurisdiction: 19 cells (2-ring), got ${jurisdiction.cells.length}`);
  assert(jurisdiction.countryCodes.includes('IT'), 'Country code: IT');

  // Territory check
  assert(sdk.isWithinJurisdiction(romeCell, jurisdiction), 'Rome center cell is within jurisdiction');

  // Berlin should NOT be in Rome jurisdiction
  const berlinCell = sdk.latLngToH3(52.5200, 13.4050, 7);
  assert(!sdk.isWithinJurisdiction(berlinCell, jurisdiction), 'Berlin is NOT within Rome jurisdiction');

  // Switzerland preset
  const chJurisdiction = sdk.createSwitzerlandJurisdiction();
  assert(chJurisdiction.countryCodes.includes('CH'), 'Switzerland jurisdiction: CH');
  assert(chJurisdiction.cells.length >= 5, `Switzerland cells: ${chJurisdiction.cells.length}`);

  // ─────────────────────────────────────────
  // 3. DELEGATE: Human → Agent Authorization
  // ─────────────────────────────────────────
  console.log('\n3. DELEGATE — Human → Agent Authorization\n');

  const cert = await sdk.createDelegationCert({
    deployerIdentity: deployer.publicKey,
    principalIdentity: human.publicKey,
    agentIdentity: agent.publicKey,
    territoryCells: jurisdiction.cells,
    facetPermissions: ['health'],
    maxSubDelegationDepth: 0,
  }, human.secretKey);

  assert(cert.certId.length === 32, `Cert ID: ${cert.certId.substring(0, 8)}...`);
  assert(cert.principalSignature.length === 128, 'Principal signature: 128 hex');
  assert(cert.certHash.length === 64, `Cert hash: ${cert.certHash.substring(0, 16)}...`);
  assert(cert.agentIdentity === agent.publicKey, 'Cert binds to correct agent');
  assert(cert.territoryCells.length === 19, 'Cert contains 19 territory cells');

  // Verify delegation
  assert(sdk.verifyDelegationCert(cert), 'Delegation signature: VALID');
  assert(sdk.isDelegationActive(cert), 'Delegation is currently active');
  assert(sdk.isDelegationAuthorizedForCell(cert, romeCell), 'Delegation authorizes Rome cell');
  assert(!sdk.isDelegationAuthorizedForCell(cert, berlinCell), 'Delegation does NOT authorize Berlin');
  assert(sdk.isDelegationAuthorizedForFacet(cert, 'health'), 'Delegation authorizes health facet');
  assert(!sdk.isDelegationAuthorizedForFacet(cert, 'finance'), 'Delegation does NOT authorize finance facet');

  // Full validation
  const validation = sdk.validateDelegation(cert, romeCell, 'health');
  assert(validation.valid, 'Full delegation validation: PASSED');
  assert(validation.errors.length === 0, 'No validation errors');

  // Tamper detection
  const tampered = { ...cert, agentIdentity: deployer.publicKey };
  assert(!sdk.verifyDelegationCert(tampered), 'Tampered cert: signature INVALID (correctly detected)');

  // ─────────────────────────────────────────
  // 4. OPERATE: Virtual Breadcrumb Chain
  // ─────────────────────────────────────────
  console.log('\n4. OPERATE — Virtual Breadcrumb Chain (Proof-of-Jurisdiction)\n');

  const breadcrumbs = [];

  // Create a chain of 10 breadcrumbs simulating agent operations
  for (let i = 0; i < 10; i++) {
    const bc = await sdk.createVirtualBreadcrumb({
      agentIdentity: agent.publicKey,
      operationCell: jurisdiction.cells[i % jurisdiction.cells.length],
      meta: {
        operationType: i % 3 === 0 ? 'inference' : i % 3 === 1 ? 'query' : 'transaction',
        delegationCertHash: cert.certHash,
        facet: 'health',
        withinTerritory: true,
        latencyMs: 50 + Math.floor(Math.random() * 200),
        modelId: 'claude-sonnet-4-5-20250929',
      },
      timestamp: new Date(Date.now() + i * 60000), // 1 minute apart
    }, agent.secretKey, breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1] : null);

    breadcrumbs.push(bc);
  }

  assert(breadcrumbs.length === 10, 'Created 10 virtual breadcrumbs');
  assert(breadcrumbs[0].index === 0, 'Genesis breadcrumb index: 0');
  assert(breadcrumbs[0].previousHash === null, 'Genesis breadcrumb: no previous hash');
  assert(breadcrumbs[9].index === 9, 'Last breadcrumb index: 9');
  assert(breadcrumbs[9].previousHash === breadcrumbs[8].blockHash, 'Hash chain: block 9 links to block 8');

  // Verify individual breadcrumbs
  assert(sdk.verifyBreadcrumb(breadcrumbs[0]), 'Genesis breadcrumb signature: VALID');
  assert(sdk.verifyBreadcrumb(breadcrumbs[5]), 'Breadcrumb #5 signature: VALID');
  assert(sdk.verifyBreadcrumb(breadcrumbs[9]), 'Last breadcrumb signature: VALID');

  // Verify full chain
  const chainResult = sdk.verifyBreadcrumbChain(breadcrumbs);
  assert(chainResult.valid, 'Full chain verification: VALID');
  assert(chainResult.verifiedCount === 10, `Verified ${chainResult.verifiedCount} blocks`);
  assert(chainResult.issues.length === 0, 'No chain integrity issues');

  // Chain statistics
  const stats = sdk.chainStatistics(breadcrumbs);
  assert(stats.totalOperations === 10, 'Chain stats: 10 total operations');
  assert(stats.withinTerritoryOps === 10, 'Chain stats: 10 within-territory operations');
  assert(stats.territoryComplianceRate === 1.0, 'Territory compliance rate: 100%');
  assert(stats.uniqueCells > 0, `Unique cells: ${stats.uniqueCells}`);

  // ─────────────────────────────────────────
  // 5. COMPLIANCE: Score & Tier Calculation
  // ─────────────────────────────────────────
  console.log('\n5. COMPLIANCE — Score & Tier Calculation\n');

  const score = sdk.calculateComplianceScore(stats, chainResult.valid, agent.createdAt);
  assert(score.tier === 'provisioned', `Tier: ${score.tier} (10 ops < 50 threshold for observed)`);
  assert(score.score > 0, `Score: ${score.score}`);
  assert(score.totalOperations === 10, 'Score reflects 10 operations');
  assert(score.violationCount === 0, 'Zero violations');
  assert(score.chainValid === true, 'Chain valid flag: true');
  assert(score.territoryComplianceRate === 1.0, 'Territory compliance: 100%');

  // Tier progression check
  const progress = sdk.nextTierProgress(score);
  assert(progress !== null, 'Progress to next tier available');
  assert(progress.nextTier === 'observed', `Next tier: ${progress.nextTier}`);
  assert(progress.opsNeeded === 40, `Operations needed: ${progress.opsNeeded}`);

  // Tier sufficiency check
  assert(sdk.isTierSufficientForFacet('trusted', 'observed'), 'Trusted tier sufficient for observed facet');
  assert(!sdk.isTierSufficientForFacet('observed', 'certified'), 'Observed tier NOT sufficient for certified facet');

  // ─────────────────────────────────────────
  // 6. MANIFEST: Public Identity Document
  // ─────────────────────────────────────────
  console.log('\n6. MANIFEST — Public Identity Document\n');

  const manifest = sdk.createAgentManifest({
    identity: agent.publicKey,
    domain: 'health',
    name: 'Gemelli Radiology Triage Agent',
    description: 'AI diagnostic agent for radiology triage at Fondazione Policlinico Gemelli',
    deployerIdentity: deployer.publicKey,
    deployerName: 'ULISSY s.r.l.',
    jurisdiction,
    facets: ['health'],
    handle: 'radiology_triage@eu',
  });

  assert(manifest.identity === agent.publicKey, 'Manifest identity matches agent');
  assert(manifest.domain === 'health', 'Domain: health');
  assert(manifest.complianceTier === 'provisioned', 'Initial tier: provisioned');
  assert(manifest.deployerName === 'ULISSY s.r.l.', 'Deployer: ULISSY s.r.l.');

  // Sign and verify manifest
  const signed = sdk.signManifest(manifest, agent.secretKey);
  assert(signed.signature.length === 128, 'Manifest signed (128 hex)');
  assert(sdk.verifyManifest(signed), 'Manifest signature: VALID');

  // Update with compliance data
  const updated = sdk.updateManifestCompliance(manifest, score.score, score.tier, 10, [cert.certHash]);
  assert(updated.breadcrumbCount === 10, 'Updated breadcrumb count: 10');
  assert(updated.activeDelegations.includes(cert.certHash), 'Active delegation recorded');

  // ─────────────────────────────────────────
  // 7. CRYPTO: Edge Cases & Utilities
  // ─────────────────────────────────────────
  console.log('\n7. CRYPTO — Edge Cases & Utilities\n');

  // Canonical JSON determinism
  const obj1 = { z: 1, a: 2, m: { b: 3, a: 4 } };
  const obj2 = { a: 2, m: { a: 4, b: 3 }, z: 1 };
  assert(sdk.canonicalJson(obj1) === sdk.canonicalJson(obj2), 'Canonical JSON: key order independent');

  // Sign and verify
  const msg = 'Hello GNS-AIP';
  const sig = sdk.sign(agent.secretKey, msg);
  assert(sdk.verify(agent.publicKey, msg, sig), 'Manual sign/verify: VALID');
  assert(!sdk.verify(agent.publicKey, 'Tampered message', sig), 'Tampered message: INVALID');
  assert(!sdk.verify(human.publicKey, msg, sig), 'Wrong public key: INVALID');

  // Validation utilities
  assert(sdk.isValidPublicKey(agent.publicKey), 'Valid public key format');
  assert(!sdk.isValidPublicKey('too_short'), 'Invalid public key rejected');
  assert(sdk.isValidSignature(sig), 'Valid signature format');

  // Nonce generation
  const nonce = sdk.generateNonce();
  assert(nonce.length === 64, `Nonce: ${nonce.substring(0, 16)}... (64 hex chars)`);

  // SHA-256
  const hash = await sdk.sha256Hex('test');
  assert(hash.length === 64, `SHA-256: ${hash.substring(0, 16)}...`);

  // Delegation header serialization
  const header = sdk.serializeDelegationHeader(cert, agent.secretKey, 'GET /api/data');
  assert(typeof header === 'string' && header.length > 0, 'Delegation header serialized');
  const parsed = sdk.parseDelegationHeader(header);
  assert(parsed !== null, 'Delegation header parsed');
  assert(parsed.agentIdentity === agent.publicKey, 'Header contains correct agent identity');
  assert(parsed.certHash === cert.certHash, 'Header contains correct cert hash');

  // ─────────────────────────────────────────
  // 8. ESCALATION: Human-in-the-Loop
  // ─────────────────────────────────────────
  console.log('\n8. ESCALATION — Human-in-the-Loop (Anti-Delegation-Drift)\n');

  // Create a finance escalation tracker (strictest default policy: 100 ops, 8 hours)
  const financeTracker = sdk.createEscalationTracker('finance', cert);
  const financeState = financeTracker.getState();
  assert(financeState.facet === 'finance', 'Finance tracker: correct facet');
  assert(financeState.maxOpsPerCert === 100, 'Finance policy: 100 ops per cert');
  assert(financeState.maxHoursPerCert === 8, 'Finance policy: 8 hours per cert');

  // Normal operations should pass
  const normalCheck = financeTracker.checkEscalation('query', romeCell);
  assert(normalCheck === null, 'Normal query operation: no escalation needed');
  financeTracker.recordOperation(romeCell);

  // High-risk operation should ALWAYS trigger escalation
  const tradeCheck = financeTracker.checkEscalation('trade_execute', romeCell);
  assert(tradeCheck !== null, 'trade_execute: escalation REQUIRED');
  assert(tradeCheck.reason === 'high_risk_operation', `Escalation reason: ${tradeCheck.reason}`);
  console.log(`  ⚠️  "${tradeCheck.message.substring(0, 70)}..."`);

  // Simulate ops threshold: record 99 operations (already have 1)
  for (let i = 0; i < 99; i++) {
    financeTracker.recordOperation(romeCell);
  }
  const opsThreshold = financeTracker.checkEscalation('query', romeCell);
  assert(opsThreshold !== null, 'After 100 ops: escalation REQUIRED');
  assert(opsThreshold.reason === 'ops_threshold', `Escalation reason: ${opsThreshold.reason}`);

  // Renew delegation → resets counters
  const freshCert = await sdk.createDelegationCert({
    deployerIdentity: deployer.publicKey,
    principalIdentity: human.publicKey,
    agentIdentity: agent.publicKey,
    territoryCells: jurisdiction.cells,
    facetPermissions: ['health', 'finance'],
  }, human.secretKey);
  financeTracker.renewDelegation(freshCert);
  assert(financeTracker.getOpsSinceCert() === 0, 'After renewal: ops counter reset to 0');
  const afterRenew = financeTracker.checkEscalation('query', romeCell);
  assert(afterRenew === null, 'After renewal: normal ops proceed');

  // New territory escalation
  const healthTracker = sdk.createEscalationTracker('health', freshCert);
  healthTracker.recordOperation(romeCell); // First cell — allowed
  const newTerritoryCheck = healthTracker.checkEscalation('query', jurisdiction.cells[5]);
  assert(newTerritoryCheck !== null, 'New territory cell: escalation REQUIRED (health facet)');
  assert(newTerritoryCheck.reason === 'new_territory', `Escalation reason: ${newTerritoryCheck.reason}`);

  // Custom policy (strengthened): 50 ops instead of default 200
  const strictHealth = sdk.createEscalationTracker('health', freshCert, { maxOpsPerCert: 50 });
  assert(strictHealth.getPolicy().maxOpsPerCert === 50, 'Custom policy: strengthened to 50 ops');

  // Custom policy (weakened attempt): 500 ops — should be capped at default 200
  const weakenedAttempt = sdk.createEscalationTracker('health', freshCert, { maxOpsPerCert: 500 });
  assert(weakenedAttempt.getPolicy().maxOpsPerCert === 200, 'Weakened policy: capped at default 200 ops');

  // General facet: no escalation policy (ops/hours both null)
  const generalTracker = sdk.createEscalationTracker('general', freshCert);
  for (let i = 0; i < 50; i++) generalTracker.recordOperation(romeCell);
  const generalCheck = generalTracker.checkEscalation('query', romeCell);
  assert(generalCheck === null, 'General facet: no ops/time escalation');

  // ─────────────────────────────────────────
  // 9. SUB-DELEGATION CHAIN: Multi-Agent
  // ─────────────────────────────────────────
  console.log('\n9. SUB-DELEGATION — Multi-Agent Chain Verification\n');

  // Scenario: Human → Manager (depth 2) → Researcher (depth 1) → Fetcher (depth 0)
  const manager = sdk.generateAgentIdentity();
  const researcher = sdk.generateAgentIdentity();
  const fetcher = sdk.generateAgentIdentity();

  // Root: Human delegates to Manager with depth 2
  const rootCert = await sdk.createDelegationCert({
    deployerIdentity: deployer.publicKey,
    principalIdentity: human.publicKey,
    agentIdentity: manager.publicKey,
    territoryCells: jurisdiction.cells,
    facetPermissions: ['health'],
    maxSubDelegationDepth: 2,
  }, human.secretKey);
  assert(rootCert.maxSubDelegationDepth === 2, 'Root cert: depth 2');

  // Hop 1: Manager → Researcher (depth 1, same territory)
  const managerToResearcher = await sdk.createSubDelegation(
    rootCert,
    researcher.publicKey,
    manager.secretKey
  );
  assert(managerToResearcher.maxSubDelegationDepth === 1, 'Sub-delegation: depth decremented to 1');
  assert(managerToResearcher.principalIdentity === manager.publicKey, 'Manager is principal of researcher cert');

  // Hop 2: Researcher → Fetcher (depth 0, narrowed territory)
  const narrowTerritory = jurisdiction.cells.slice(0, 5); // Subset
  const researcherToFetcher = await sdk.createSubDelegation(
    managerToResearcher,
    fetcher.publicKey,
    researcher.secretKey,
    { territoryCells: narrowTerritory }
  );
  assert(researcherToFetcher.maxSubDelegationDepth === 0, 'Leaf cert: depth 0');
  assert(researcherToFetcher.territoryCells.length === 5, 'Leaf territory narrowed to 5 cells');

  // Build the full chain
  const allCerts = [rootCert, managerToResearcher, researcherToFetcher];
  const chain = sdk.buildDelegationChain(researcherToFetcher, allCerts);
  assert(chain !== null, 'Delegation chain: built successfully');
  assert(chain.length === 3, `Chain depth: ${chain.length} (Human→Manager→Researcher→Fetcher)`);

  // Verify the chain
  const humanSet = new Set([human.publicKey]);
  const chainResult2 = sdk.verifyDelegationChain(chain, humanSet);
  assert(chainResult2.valid, 'Full delegation chain: VALID');
  assert(chainResult2.errors.length === 0, 'No chain verification errors');
  assert(chainResult2.depth === 3, `Chain depth: ${chainResult2.depth}`);
  assert(chainResult2.rootPrincipal === human.publicKey, 'Root principal: human identity confirmed');

  // Extract root principal
  const rootPrincipal = sdk.getRootPrincipal(chain);
  assert(rootPrincipal === human.publicKey, `Root principal: ${rootPrincipal.substring(0, 16)}... (human)`);

  // Get effective constraints (intersection of all chain)
  const effective = sdk.getEffectiveConstraints(chain);
  assert(effective !== null, 'Effective constraints computed');
  assert(effective.territoryCells.length === 5, 'Effective territory: 5 cells (narrowest)');
  assert(effective.facetPermissions.includes('health'), 'Effective facets: health');
  assert(effective.maxSubDelegationDepth === 0, 'Leaf cannot sub-delegate further');
  assert(effective.rootPrincipal === human.publicKey, 'Effective root: human');
  assert(effective.leafAgent === fetcher.publicKey, 'Effective leaf: fetcher');

  // Test: Fetcher cannot sub-delegate (depth 0)
  let subDelegationBlocked = false;
  try {
    await sdk.createSubDelegation(researcherToFetcher, sdk.generateAgentIdentity().publicKey, fetcher.secretKey);
  } catch (e) {
    subDelegationBlocked = true;
    assert(e.message.includes('maxSubDelegationDepth=0'), 'Sub-delegation blocked: depth 0');
  }
  assert(subDelegationBlocked, 'Leaf agent correctly blocked from sub-delegating');

  // Test: Cannot widen territory beyond parent
  let territoryWidenBlocked = false;
  try {
    await sdk.createSubDelegation(managerToResearcher, sdk.generateAgentIdentity().publicKey, researcher.secretKey, {
      territoryCells: [...jurisdiction.cells, '8f2830828052d25'], // Extra cell not in parent
    });
  } catch (e) {
    territoryWidenBlocked = true;
  }
  assert(territoryWidenBlocked, 'Territory widening correctly blocked');

  // Test: Broken chain (wrong human set)
  const wrongHumanSet = new Set([deployer.publicKey]); // deployer ≠ human
  const brokenResult = sdk.verifyDelegationChain(chain, wrongHumanSet);
  assert(!brokenResult.valid, 'Wrong human set: chain INVALID');
  assert(brokenResult.errors.some(e => e.includes('not a recognized human')), 'Error identifies non-human root');

  // ─────────────────────────────────────────
  // 10. MCP MIDDLEWARE: Server-Side Gating
  // ─────────────────────────────────────────
  console.log('\n10. MCP MIDDLEWARE — Server-Side Compliance Gating\n');

  // Simulated database lookups
  const certDB = new Map();
  certDB.set(cert.certHash, cert);
  certDB.set(freshCert.certHash, freshCert);

  const tierDB = new Map();
  tierDB.set(agent.publicKey, 'trusted');

  // Create MCP middleware for a health data MCP server
  const middleware = sdk.createMCPMiddleware({
    minimumTier: 'trusted',
    requiredFacet: 'health',
    serverTerritoryCells: jurisdiction.cells,
    certLookup: async (hash) => certDB.get(hash) || null,
    tierLookup: async (identity) => tierDB.get(identity) || null,
  });

  // Test: Valid request passes
  const validHeader = sdk.serializeDelegationHeader(freshCert, agent.secretKey, 'GET /patient/123');
  try {
    const result = await middleware.guard(
      { delegationHeader: validHeader, requestData: 'GET /patient/123' },
      async () => ({ data: 'patient record' })
    );
    assert(result.data === 'patient record', 'Valid MCP request: handler executed');
  } catch (e) {
    assert(false, `Valid MCP request failed: ${e.message}`);
  }

  // Test: Missing header → rejected
  const missingResult = await middleware.verify({ delegationHeader: null });
  assert(!missingResult.authorized, 'Missing header: rejected');
  assert(missingResult.reason === 'missing_header', `Reject reason: ${missingResult.reason}`);

  // Test: Invalid header → rejected
  const invalidResult = await middleware.verify({ delegationHeader: 'not-valid-base64!!!' });
  assert(!invalidResult.authorized, 'Invalid header: rejected');

  // Test: Unknown cert → rejected
  const unknownCert = await sdk.createDelegationCert({
    deployerIdentity: deployer.publicKey,
    principalIdentity: human.publicKey,
    agentIdentity: agent.publicKey,
    territoryCells: jurisdiction.cells,
    facetPermissions: ['health'],
  }, human.secretKey);
  const unknownHeader = sdk.serializeDelegationHeader(unknownCert, agent.secretKey);
  // DON'T add to certDB
  const unknownResult = await middleware.verify({ delegationHeader: unknownHeader });
  assert(!unknownResult.authorized, 'Unknown cert: rejected');
  assert(unknownResult.reason === 'unknown_cert', `Reject reason: ${unknownResult.reason}`);

  // Test: Insufficient tier → rejected
  tierDB.set(agent.publicKey, 'provisioned'); // Downgrade tier
  const lowTierResult = await middleware.verify(
    { delegationHeader: validHeader, requestData: 'GET /patient/123' }
  );
  assert(!lowTierResult.authorized, 'Insufficient tier: rejected');
  assert(lowTierResult.reason === 'insufficient_tier', `Reject reason: ${lowTierResult.reason}`);
  tierDB.set(agent.publicKey, 'trusted'); // Restore

  // Test: Wrong facet → rejected
  const financeMiddleware = sdk.createMCPMiddleware({
    minimumTier: 'observed',
    requiredFacet: 'finance',  // Agent only has 'health'
    serverTerritoryCells: [],
    certLookup: async (hash) => certDB.get(hash) || null,
    tierLookup: async (identity) => tierDB.get(identity) || null,
  });
  // Use cert that only has health+finance — freshCert has both, so make health-only
  const healthOnlyCert = await sdk.createDelegationCert({
    deployerIdentity: deployer.publicKey,
    principalIdentity: human.publicKey,
    agentIdentity: agent.publicKey,
    territoryCells: jurisdiction.cells,
    facetPermissions: ['health'], // NO finance
  }, human.secretKey);
  certDB.set(healthOnlyCert.certHash, healthOnlyCert);
  const healthOnlyHeader = sdk.serializeDelegationHeader(healthOnlyCert, agent.secretKey);
  const facetResult = await financeMiddleware.verify({ delegationHeader: healthOnlyHeader });
  assert(!facetResult.authorized, 'Wrong facet: rejected');
  assert(facetResult.reason === 'facet_denied', `Reject reason: ${facetResult.reason}`);

  // Test: MCPGateError has proper structure
  try {
    await middleware.guard({ delegationHeader: null }, async () => 'should not reach');
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e instanceof sdk.MCPGateError, 'MCPGateError instance');
    assert(e.code === 'missing_header', `MCPGateError.code: ${e.code}`);
  }

  // ─────────────────────────────────────────
  // RESULTS
  // ─────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
