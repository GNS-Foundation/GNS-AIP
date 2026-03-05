/**
 * @gns-aip/aws — IAM OIDC Federation Test Suite
 *
 * Tests:
 *   1.  Token decode — extracts claims from GNS JWT
 *   2.  Token validation — rejects expired tokens
 *   3.  Token validation — rejects wrong audience
 *   4.  Token validation — accepts correct aud=sts.amazonaws.com
 *   5.  Session tags — all GNS claims mapped as strings
 *   6.  Session tags — max 50 tags enforced
 *   7.  Session tags — territory mapped as region prefix (first 3 chars)
 *   8.  Credential vendor — returns AccessKeyId/SecretAccessKey/SessionToken
 *   9.  Credential vendor — rejects expired token
 *   10. Credential vendor — session tags embedded in result
 *   11. Role chaining — transitive session tags preserved
 *   12. Trust policy — correct Principal + Action + Condition structure
 *   13. Trust policy — sts:TagSession included (required for ABAC)
 *   14. Trust policy — aud condition uses id.gns.foundation prefix
 *   15. Permission policy — DenyInsufficientTrustTier statement present
 *   16. Permission policy — DenyStaleHumanityProof statement present
 *   17. Permission policy — ABAC conditions on aws:PrincipalTag/*
 *   18. All 4 tiers generate distinct policies
 *   19. Higher tiers include lower tiers in allowedTiers
 *   20. CloudFormation — valid JSON with OIDCProvider + 4 role resources
 *   21. CloudFormation — ThumbprintList present (required by IAM)
 *   22. Terraform — contains aws_iam_openid_connect_provider resource
 *   23. Terraform — contains aws_iam_role for all 4 tiers
 *   24. OIDC provider registration — correct issuer URL + audience
 *   25. createGnsAwsVendor factory — returns GnsAwsCredentialVendor instance
 */

import {
  GnsTokenValidator,
  GnsAwsCredentialVendor,
  GnsIamPolicyGenerator,
  GNS_TAG_KEYS,
  createGnsAwsVendor,
} from './dist/index.js';

let passed = 0;
let failed = 0;

const pass = (msg) => { console.log(`  ✅ ${msg}`); passed++; };
const fail = (msg, err) => { console.error(`  ❌ ${msg}: ${err}`); failed++; };
const assert = (cond, msg) => cond ? pass(msg) : fail(msg, 'assertion failed');

const AWS_ACCOUNT_ID = '123456789012';

// ── Token fixtures ────────────────────────────────────────────────────────────

function makeJwt(payload, expired = false) {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    iss: 'https://id.gns.foundation',
    sub: 'a'.repeat(64),
    aud: 'sts.amazonaws.com',
    exp: expired ? now - 60 : now + 3600,
    iat: now,
    jti: 'test-jti',
    gns_trust_tier: 'NAVIGATOR',
    gns_trust_score: 72,
    gns_breadcrumb_count: 340,
    gns_humanity_proof_valid: true,
    gns_subject_type: 'human',
    gns_handle: 'camilo@rome',
    gns_territory: ['871e8052affffff', '871e8053affffff'],
    gns_protocol_version: '2.0',
    ...payload,
  };
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  return `${header}.${payloadB64}.fake-ed25519-signature`;
}

const VALID_TOKEN = makeJwt({});
const EXPIRED_TOKEN = makeJwt({}, true);
const WRONG_AUD_TOKEN = makeJwt({ aud: 'wrong-audience' });
const AGENT_TOKEN = makeJwt({ gns_subject_type: 'ai_agent', gns_agent_id: 'b'.repeat(64) });
const NO_TERRITORY_TOKEN = makeJwt({ gns_territory: null });

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' @gns-aip/aws — IAM OIDC Federation Test Suite');
  console.log('══════════════════════════════════════════════════\n');

  const validator = new GnsTokenValidator();

  // ── 1. TOKEN DECODE ───────────────────────────────────────────────────────
  console.log('1. TOKEN DECODE — Extracts GNS claims from JWT\n');

  const claims = validator.decode(VALID_TOKEN);
  assert(claims.sub === 'a'.repeat(64), 'sub is GNS public key (64 hex chars)');
  assert(claims.aud === 'sts.amazonaws.com', 'aud is sts.amazonaws.com');
  assert(claims.gns_trust_tier === 'NAVIGATOR', 'gns_trust_tier decoded');
  assert(claims.gns_trust_score === 72, 'gns_trust_score decoded as number');
  assert(claims.gns_breadcrumb_count === 340, 'gns_breadcrumb_count decoded');
  assert(claims.gns_humanity_proof_valid === true, 'gns_humanity_proof_valid decoded');
  assert(claims.gns_subject_type === 'human', 'gns_subject_type decoded');
  assert(claims.gns_handle === 'camilo@rome', 'gns_handle decoded');
  assert(Array.isArray(claims.gns_territory), 'gns_territory is array');

  try {
    validator.decode('notajwt');
    fail('Malformed JWT should throw', 'no error thrown');
  } catch { pass('Malformed JWT throws'); }

  // ── 2. TOKEN VALIDATION — EXPIRED ─────────────────────────────────────────
  console.log('\n2. TOKEN VALIDATION — Rejects expired tokens\n');

  const expiredResult = validator.validateForSts(EXPIRED_TOKEN);
  assert(!expiredResult.valid, 'Expired token fails validation');
  assert(expiredResult.reason === 'Token expired', 'Reason is "Token expired"');

  // ── 3. TOKEN VALIDATION — WRONG AUDIENCE ──────────────────────────────────
  console.log('\n3. TOKEN VALIDATION — Rejects wrong audience\n');

  const wrongAudResult = validator.validateForSts(WRONG_AUD_TOKEN);
  assert(!wrongAudResult.valid, 'Wrong audience fails validation');
  assert(wrongAudResult.reason?.includes('Audience mismatch'), 'Reason mentions audience mismatch');

  // ── 4. TOKEN VALIDATION — VALID ───────────────────────────────────────────
  console.log('\n4. TOKEN VALIDATION — Accepts correct aud=sts.amazonaws.com\n');

  const validResult = validator.validateForSts(VALID_TOKEN);
  assert(validResult.valid, 'Valid token passes validation');
  assert(validResult.claims !== undefined, 'Claims returned on success');
  assert(validResult.claims.sub === 'a'.repeat(64), 'Sub matches');

  // ── 5. SESSION TAGS — STRING TYPES ────────────────────────────────────────
  console.log('\n5. SESSION TAGS — All GNS claims mapped as strings\n');

  const tags = validator.claimsToSessionTags(claims);

  assert(typeof tags[GNS_TAG_KEYS.TRUST_TIER] === 'string', 'gns:trust_tier is string');
  assert(typeof tags[GNS_TAG_KEYS.TRUST_SCORE] === 'string', 'gns:trust_score is string');
  assert(typeof tags[GNS_TAG_KEYS.BREADCRUMB_COUNT] === 'string', 'gns:breadcrumb_count is string');
  assert(typeof tags[GNS_TAG_KEYS.HUMANITY_PROOF_VALID] === 'string', 'gns:humanity_proof_valid is string');
  assert(typeof tags[GNS_TAG_KEYS.SUBJECT_TYPE] === 'string', 'gns:subject_type is string');
  assert(typeof tags[GNS_TAG_KEYS.HANDLE] === 'string', 'gns:handle is string');
  assert(typeof tags[GNS_TAG_KEYS.PROTOCOL_VERSION] === 'string', 'gns:protocol_version is string');

  assert(tags[GNS_TAG_KEYS.TRUST_TIER] === 'NAVIGATOR', 'Trust tier value correct');
  assert(tags[GNS_TAG_KEYS.HUMANITY_PROOF_VALID] === 'true', 'Humanity proof valid is "true" string');
  assert(tags[GNS_TAG_KEYS.TRUST_SCORE] === '72', 'Trust score serialized as string');
  assert(tags[GNS_TAG_KEYS.BREADCRUMB_COUNT] === '340', 'Breadcrumb count serialized as string');

  // ── 6. SESSION TAGS — MAX 50 ──────────────────────────────────────────────
  console.log('\n6. SESSION TAGS — Count within AWS 50-tag limit\n');

  assert(Object.keys(tags).length <= 50, `Tag count ${Object.keys(tags).length} ≤ 50 (AWS limit)`);

  // ── 7. SESSION TAGS — TERRITORY REGION PREFIX ─────────────────────────────
  console.log('\n7. SESSION TAGS — Territory mapped as H3 region prefix\n');

  assert(GNS_TAG_KEYS.TERRITORY_REGION in tags, 'gns:territory_region tag present');
  assert(tags[GNS_TAG_KEYS.TERRITORY_REGION] === '871', 'Territory region is first 3 chars of H3 cell');
  assert(tags[GNS_TAG_KEYS.TERRITORY_REGION].length === 3, 'Territory region prefix is exactly 3 chars');

  // No territory → no region tag
  const noTerrClaims = validator.decode(NO_TERRITORY_TOKEN);
  const noTerrTags = validator.claimsToSessionTags(noTerrClaims);
  assert(!(GNS_TAG_KEYS.TERRITORY_REGION in noTerrTags), 'No territory_region tag when territory is null');

  // ── 8. CREDENTIAL VENDOR — RETURNS CREDENTIALS ────────────────────────────
  console.log('\n8. CREDENTIAL VENDOR — Returns AWS credential structure\n');

  const vendor = new GnsAwsCredentialVendor({
    roleArn: `arn:aws:iam::${AWS_ACCOUNT_ID}:role/gns-navigator-role`,
    gnsOidcProviderArn: `arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/id.gns.foundation`,
  });

  const creds = await vendor.assumeRole(VALID_TOKEN);

  assert(typeof creds.accessKeyId === 'string' && creds.accessKeyId.length > 0, 'accessKeyId returned');
  assert(typeof creds.secretAccessKey === 'string' && creds.secretAccessKey.length > 0, 'secretAccessKey returned');
  assert(typeof creds.sessionToken === 'string' && creds.sessionToken.length > 0, 'sessionToken returned');
  assert(creds.expiration instanceof Date, 'expiration is Date object');
  assert(creds.expiration > new Date(), 'expiration is in the future');
  assert(typeof creds.assumedRoleArn === 'string', 'assumedRoleArn returned');
  assert(creds.assumedRoleArn.includes(AWS_ACCOUNT_ID), 'assumedRoleArn contains account ID');

  // ── 9. CREDENTIAL VENDOR — REJECTS EXPIRED TOKEN ──────────────────────────
  console.log('\n9. CREDENTIAL VENDOR — Rejects expired token\n');

  try {
    await vendor.assumeRole(EXPIRED_TOKEN);
    fail('Expired token should throw', 'no error thrown');
  } catch (err) {
    assert(err.message.includes('Token validation failed'), 'Throws with validation message');
    assert(err.message.includes('expired'), 'Error mentions expired');
  }

  // ── 10. CREDENTIAL VENDOR — SESSION TAGS IN RESULT ────────────────────────
  console.log('\n10. CREDENTIAL VENDOR — Session tags embedded in credentials\n');

  assert(typeof creds.sessionTags === 'object', 'sessionTags present in credentials');
  assert(creds.sessionTags[GNS_TAG_KEYS.TRUST_TIER] === 'NAVIGATOR', 'Trust tier in session tags');
  assert(creds.sessionTags[GNS_TAG_KEYS.HUMANITY_PROOF_VALID] === 'true', 'Humanity proof in session tags');
  assert(creds.sessionTags[GNS_TAG_KEYS.SUBJECT_TYPE] === 'human', 'Subject type in session tags');

  // ── 11. ROLE CHAINING — TRANSITIVE SESSION TAGS ───────────────────────────
  console.log('\n11. ROLE CHAINING — Session tags preserved across chained roles\n');

  const chainedCreds = await vendor.chainRole(
    creds,
    `arn:aws:iam::${AWS_ACCOUNT_ID}:role/gns-trailblazer-role`
  );

  assert(chainedCreds.sessionTags[GNS_TAG_KEYS.TRUST_TIER] === 'NAVIGATOR', 'Session tags transitive in chain');
  assert(chainedCreds.assumedRoleArn.includes('trailblazer'), 'Chain role ARN updated');
  assert(chainedCreds.accessKeyId !== creds.accessKeyId, 'New credentials for chained role');

  // ── 12. TRUST POLICY STRUCTURE ────────────────────────────────────────────
  console.log('\n12. TRUST POLICY — Correct Principal + Action + Condition\n');

  const navigatorPolicies = GnsIamPolicyGenerator.forTier('NAVIGATOR', { awsAccountId: AWS_ACCOUNT_ID });
  const trust = navigatorPolicies.trustPolicy;

  assert(trust.Version === '2012-10-17', 'Policy version is 2012-10-17');
  assert(Array.isArray(trust.Statement), 'Statement is array');
  assert(trust.Statement[0].Effect === 'Allow', 'Effect is Allow');
  assert(typeof trust.Statement[0].Principal.Federated === 'string', 'Principal.Federated is string');
  assert(trust.Statement[0].Principal.Federated.includes(AWS_ACCOUNT_ID), 'Federated ARN includes account ID');
  assert(trust.Statement[0].Principal.Federated.includes('id.gns.foundation'), 'Federated ARN includes GNS provider');

  // ── 13. TRUST POLICY — sts:TagSession ────────────────────────────────────
  console.log('\n13. TRUST POLICY — sts:TagSession included (required for ABAC)\n');

  const actions = trust.Statement[0].Action;
  assert(Array.isArray(actions), 'Action is array');
  assert(actions.includes('sts:AssumeRoleWithWebIdentity'), 'sts:AssumeRoleWithWebIdentity present');
  assert(actions.includes('sts:TagSession'), 'sts:TagSession present — required for session tag propagation');

  // ── 14. TRUST POLICY — AUD CONDITION ─────────────────────────────────────
  console.log('\n14. TRUST POLICY — aud condition uses id.gns.foundation: prefix\n');

  const conds = trust.Statement[0].Condition.StringEquals;
  assert('id.gns.foundation:aud' in conds, 'Condition key is id.gns.foundation:aud');
  assert(conds['id.gns.foundation:aud'] === 'sts.amazonaws.com', 'aud condition value is sts.amazonaws.com');

  // ── 15. PERMISSION POLICY — DENY INSUFFICIENT TIER ───────────────────────
  console.log('\n15. PERMISSION POLICY — DenyInsufficientTrustTier statement\n');

  const perm = navigatorPolicies.permissionPolicy;
  const denyTierStmt = perm.Statement.find(s => s.Sid === 'DenyInsufficientTrustTier');
  assert(!!denyTierStmt, 'DenyInsufficientTrustTier statement present');
  assert(denyTierStmt.Effect === 'Deny', 'Effect is Deny');
  assert(denyTierStmt.Action === '*', 'Denies all actions');
  assert(denyTierStmt.Resource === '*', 'Denies all resources');
  assert('aws:PrincipalTag/gns:trust_tier' in denyTierStmt.Condition.StringNotEquals,
    'Condition on aws:PrincipalTag/gns:trust_tier');

  // ── 16. PERMISSION POLICY — DENY STALE HUMANITY PROOF ────────────────────
  console.log('\n16. PERMISSION POLICY — DenyStaleHumanityProof statement\n');

  const denyHumanityStmt = perm.Statement.find(s => s.Sid === 'DenyStaleHumanityProof');
  assert(!!denyHumanityStmt, 'DenyStaleHumanityProof statement present');
  assert(denyHumanityStmt.Effect === 'Deny', 'Effect is Deny');
  assert('aws:PrincipalTag/gns:humanity_proof_valid' in denyHumanityStmt.Condition.StringNotEquals,
    'Condition on aws:PrincipalTag/gns:humanity_proof_valid');
  assert(
    denyHumanityStmt.Condition.StringNotEquals['aws:PrincipalTag/gns:humanity_proof_valid'] === 'true',
    'Denies when humanity_proof_valid != "true"'
  );

  // ── 17. PERMISSION POLICY — ABAC CONDITIONS ───────────────────────────────
  console.log('\n17. PERMISSION POLICY — ABAC on aws:PrincipalTag/*\n');

  const allowStmt = perm.Statement.find(s => s.Sid?.startsWith('Allow'));
  assert(!!allowStmt, 'Allow statement present');
  assert(allowStmt.Effect === 'Allow', 'Effect is Allow');
  assert('aws:PrincipalTag/gns:trust_tier' in allowStmt.Condition.StringEquals,
    'Allow condition uses aws:PrincipalTag/gns:trust_tier');
  assert('aws:PrincipalTag/gns:humanity_proof_valid' in allowStmt.Condition.StringEquals,
    'Allow condition uses aws:PrincipalTag/gns:humanity_proof_valid');

  // ── 18. ALL 4 TIERS — DISTINCT POLICIES ──────────────────────────────────
  console.log('\n18. ALL TIERS — 4 distinct policy sets generated\n');

  const allTiers = GnsIamPolicyGenerator.allTiers({ awsAccountId: AWS_ACCOUNT_ID });
  assert(Object.keys(allTiers).length === 4, '4 tier policies generated');
  assert('SEEDLING' in allTiers, 'SEEDLING policy present');
  assert('EXPLORER' in allTiers, 'EXPLORER policy present');
  assert('NAVIGATOR' in allTiers, 'NAVIGATOR policy present');
  assert('TRAILBLAZER' in allTiers, 'TRAILBLAZER policy present');

  // Policies should differ
  const seedlingAllow = allTiers.SEEDLING.permissionPolicy.Statement.find(s => s.Sid?.startsWith('Allow'));
  const trailAllow = allTiers.TRAILBLAZER.permissionPolicy.Statement.find(s => s.Sid?.startsWith('Allow'));
  assert(
    JSON.stringify(seedlingAllow.Action) !== JSON.stringify(trailAllow.Action),
    'SEEDLING and TRAILBLAZER have different allowed actions'
  );

  // ── 19. TIER HIERARCHY — HIGHER INCLUDES LOWER ───────────────────────────
  console.log('\n19. TIER HIERARCHY — Higher tiers include lower tiers in deny condition\n');

  const seedlingTiers = allTiers.SEEDLING.permissionPolicy.Statement
    .find(s => s.Sid === 'DenyInsufficientTrustTier')
    .Condition.StringNotEquals['aws:PrincipalTag/gns:trust_tier'];
  const navigatorTiers = allTiers.NAVIGATOR.permissionPolicy.Statement
    .find(s => s.Sid === 'DenyInsufficientTrustTier')
    .Condition.StringNotEquals['aws:PrincipalTag/gns:trust_tier'];

  assert(seedlingTiers.length > navigatorTiers.length,
    'SEEDLING allows more tiers than NAVIGATOR (inclusive downward)');
  assert(navigatorTiers.includes('TRAILBLAZER'), 'NAVIGATOR allows TRAILBLAZER');
  assert(navigatorTiers.includes('NAVIGATOR'), 'NAVIGATOR allows NAVIGATOR');
  assert(!navigatorTiers.includes('SEEDLING'), 'NAVIGATOR does not allow SEEDLING');

  // ── 20. CLOUDFORMATION — VALID JSON + RESOURCES ───────────────────────────
  console.log('\n20. CLOUDFORMATION — Valid JSON with all required resources\n');

  const cfnStr = GnsIamPolicyGenerator.cloudFormation({ awsAccountId: AWS_ACCOUNT_ID });
  let cfn;
  try {
    cfn = JSON.parse(cfnStr);
    pass('CloudFormation is valid JSON');
  } catch (err) {
    fail('CloudFormation is valid JSON', err.message);
  }

  assert(cfn.AWSTemplateFormatVersion === '2010-09-09', 'AWSTemplateFormatVersion correct');
  assert('GnsOidcProvider' in cfn.Resources, 'GnsOidcProvider resource present');
  assert(cfn.Resources.GnsOidcProvider.Type === 'AWS::IAM::OIDCProvider', 'OIDCProvider type correct');
  assert('GnsSeedlingRole' in cfn.Resources, 'GnsSeedlingRole resource present');
  assert('GnsExplorerRole' in cfn.Resources, 'GnsExplorerRole resource present');
  assert('GnsNavigatorRole' in cfn.Resources, 'GnsNavigatorRole resource present');
  assert('GnsTrailblazerRole' in cfn.Resources, 'GnsTrailblazerRole resource present');
  assert('GnsOidcProviderArn' in cfn.Outputs, 'GnsOidcProviderArn output present');

  // ── 21. CLOUDFORMATION — THUMBPRINT LIST ──────────────────────────────────
  console.log('\n21. CLOUDFORMATION — ThumbprintList present (required by IAM)\n');

  assert(
    Array.isArray(cfn.Resources.GnsOidcProvider.Properties.ThumbprintList),
    'ThumbprintList is array'
  );
  assert(
    cfn.Resources.GnsOidcProvider.Properties.ThumbprintList.length > 0,
    'ThumbprintList has at least one entry'
  );
  assert(
    cfn.Resources.GnsOidcProvider.Properties.ClientIdList.includes('sts.amazonaws.com'),
    'ClientIdList includes sts.amazonaws.com'
  );

  // ── 22. TERRAFORM — OIDC PROVIDER RESOURCE ───────────────────────────────
  console.log('\n22. TERRAFORM — Contains aws_iam_openid_connect_provider\n');

  const hcl = GnsIamPolicyGenerator.terraform({ awsAccountId: AWS_ACCOUNT_ID });
  assert(typeof hcl === 'string', 'Terraform output is string');
  assert(hcl.includes('aws_iam_openid_connect_provider'), 'Contains OIDC provider resource');
  assert(hcl.includes('id.gns.foundation'), 'Contains GNS issuer URL');
  assert(hcl.includes('sts.amazonaws.com'), 'Contains sts.amazonaws.com audience');
  assert(hcl.includes('var.gns_tls_thumbprint'), 'Thumbprint is a variable (not hardcoded)');
  assert(hcl.includes('output "gns_oidc_provider_arn"'), 'Exports provider ARN output');

  // ── 23. TERRAFORM — 4 TIER ROLES ─────────────────────────────────────────
  console.log('\n23. TERRAFORM — Contains aws_iam_role for all 4 tiers\n');

  assert(hcl.includes('aws_iam_role" "gns_seedling"'), 'SEEDLING role resource');
  assert(hcl.includes('aws_iam_role" "gns_explorer"'), 'EXPLORER role resource');
  assert(hcl.includes('aws_iam_role" "gns_navigator"'), 'NAVIGATOR role resource');
  assert(hcl.includes('aws_iam_role" "gns_trailblazer"'), 'TRAILBLAZER role resource');
  assert(hcl.includes('aws_iam_role_policy'), 'Role policy resources present');

  // ── 24. OIDC PROVIDER REGISTRATION ───────────────────────────────────────
  console.log('\n24. OIDC PROVIDER REGISTRATION — Correct issuer + audience\n');

  const reg = GnsIamPolicyGenerator.oidcProviderRegistration();
  assert(reg.providerUrl === 'https://id.gns.foundation', 'Provider URL is id.gns.foundation');
  assert(reg.clientId === 'sts.amazonaws.com', 'Client ID is sts.amazonaws.com');
  assert(typeof reg.thumbprint === 'string' && reg.thumbprint.length === 40, 'Thumbprint is 40 chars (SHA-1 hex)');

  // ── 25. FACTORY FUNCTION ──────────────────────────────────────────────────
  console.log('\n25. FACTORY — createGnsAwsVendor returns GnsAwsCredentialVendor\n');

  const factoryVendor = createGnsAwsVendor({
    roleArn: `arn:aws:iam::${AWS_ACCOUNT_ID}:role/gns-navigator-role`,
    gnsOidcProviderArn: `arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/id.gns.foundation`,
  });

  const factoryCreds = await factoryVendor.assumeRole(VALID_TOKEN);
  assert(typeof factoryCreds.accessKeyId === 'string', 'Factory vendor issues credentials');
  assert(factoryCreds.sessionTags[GNS_TAG_KEYS.TRUST_TIER] === 'NAVIGATOR', 'Factory vendor tags correct');

  // Agent token — session tags reflect ai_agent subject type
  const agentCreds = await factoryVendor.assumeRole(AGENT_TOKEN);
  assert(agentCreds.sessionTags[GNS_TAG_KEYS.SUBJECT_TYPE] === 'ai_agent', 'Agent subject type in session tags');

  // ── RESULTS ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error(err); process.exit(1); });
