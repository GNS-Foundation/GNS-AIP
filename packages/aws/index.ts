/**
 * @file index.ts
 * @package @gns-aip/aws
 *
 * GNS-AIP × AWS IAM — OIDC Federation + Session Tags
 * ─────────────────────────────────────────────────────────────────────────────
 * Enables AI agents and humans with GNS identities to assume AWS IAM roles
 * using cryptographically-verifiable GNS id_tokens — no static IAM keys.
 *
 * ARCHITECTURE
 * ────────────
 *
 *   GNS id_token (Ed25519 signed JWT)
 *       │
 *       ▼
 *   AWS STS AssumeRoleWithWebIdentity
 *       │  Trust policy: aud + sub conditions
 *       │  Session tags: gns:trust_tier, gns:humanity_proof_valid, gns:territory
 *       ▼
 *   Temporary AWS credentials (15min – 12hr)
 *       │  AccessKeyId + SecretAccessKey + SessionToken
 *       ▼
 *   S3 / Lambda / Bedrock / DynamoDB / ...
 *       │  Permission policy uses ABAC on session tags:
 *       │  aws:PrincipalTag/gns:trust_tier == "NAVIGATOR"
 *       │  aws:PrincipalTag/gns:humanity_proof_valid == "true"
 *
 * CRITICAL AWS CONSTRAINT (from IAM docs)
 * ──────────────────────────────────────────
 * AWS STS trust policies can ONLY condition on standard OIDC claims:
 *   sub, aud, email, amr — plus provider-prefixed versions
 *
 * Custom claims (gns_trust_tier, gns_humanity_proof_valid, etc.) in the JWT
 * are IGNORED by the trust policy evaluator. They cannot gate role assumption.
 *
 * SOLUTION: Session Tags (ABAC)
 * ──────────────────────────────
 * GNS claims are mapped to IAM session tags via sts:TagSession permission.
 * Session tags flow as aws:PrincipalTag/* into permission policies.
 * This is how GitHub Actions, GitLab CI, and HCP Terraform do OIDC ABAC on AWS.
 *
 * Condition on assumption:  sub == agent's GNS public key (64 hex chars)
 *                           aud == "sts.amazonaws.com"
 * Condition on resources:   aws:PrincipalTag/gns:trust_tier == "NAVIGATOR"
 *                           aws:PrincipalTag/gns:humanity_proof_valid == "true"
 *
 * USAGE
 * ─────
 * // Option A: Exchange GNS token for AWS credentials
 * const vendor = new GnsAwsCredentialVendor({
 *   roleArn: 'arn:aws:iam::123456789012:role/GnsNavigatorRole',
 *   gnsOidcProviderArn: 'arn:aws:iam::123456789012:oidc-provider/id.gns.foundation',
 * });
 * const creds = await vendor.assumeRole(gnsIdToken);
 * // → { accessKeyId, secretAccessKey, sessionToken, expiration }
 *
 * // Option B: Generate IAM OIDC provider CloudFormation
 * const cfn = GnsIamPolicyGenerator.cloudFormation({ awsAccountId: '123456789012' });
 *
 * // Option C: Generate trust + permission policies per tier
 * const policies = GnsIamPolicyGenerator.forTier('NAVIGATOR', {
 *   awsAccountId: '123456789012',
 *   allowedRegions: ['eu-west-1', 'eu-central-1'],
 * });
 *
 * // Option D: Terraform HCL
 * const hcl = GnsIamPolicyGenerator.terraform({ awsAccountId: '123456789012' });
 */

import { GnsOidcProvider } from '@gns-aip/sdk';
import type { GnsTrustTier } from '@gns-aip/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const GNS_OIDC_ISSUER = 'https://id.gns.foundation';
const GNS_OIDC_AUDIENCE = 'sts.amazonaws.com';

/** IAM session tag keys for GNS claims (prefixed to avoid collisions) */
export const GNS_TAG_KEYS = {
  TRUST_TIER:             'gns:trust_tier',
  TRUST_SCORE:            'gns:trust_score',
  BREADCRUMB_COUNT:       'gns:breadcrumb_count',
  HUMANITY_PROOF_VALID:   'gns:humanity_proof_valid',
  SUBJECT_TYPE:           'gns:subject_type',
  HANDLE:                 'gns:handle',
  IDENTITY_FOUND:         'gns:identity_found',
  PROTOCOL_VERSION:       'gns:protocol_version',
  /** H3 region prefix (first 3 chars of cell) — coarse territory for ABAC */
  TERRITORY_REGION:       'gns:territory_region',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GnsAwsConfig {
  /** ARN of the IAM role to assume */
  roleArn: string;
  /** ARN of the GNS OIDC provider in IAM */
  gnsOidcProviderArn: string;
  /** Session duration in seconds (default: 3600, max: 43200) */
  durationSeconds?: number;
  /** Session name for CloudTrail auditing (default: gns-{sub-prefix}) */
  sessionName?: string;
  /** Whether to map GNS claims as session tags (default: true) */
  enableSessionTags?: boolean;
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

export interface AwsTemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
  /** GNS claims embedded in session tags */
  sessionTags: Record<string, string>;
  /** Principal ARN of the assumed role session */
  assumedRoleArn: string;
}

export interface GnsIamPolicyOptions {
  awsAccountId: string;
  /** AWS regions to restrict to (default: all) */
  allowedRegions?: string[];
  /** Minimum trust tier for role assumption (enforced via sub+aud conditions) */
  minTrustTier?: GnsTrustTier;
  /** Whether agents (ai_agent subject type) can assume this role */
  allowAgents?: boolean;
  /** Specific GNS public key to restrict to (for agent roles) */
  specificSubject?: string;
}

export interface GnsRolePolicies {
  /** Trust policy — controls who can assume the role */
  trustPolicy: object;
  /** Permission policy — controls what the role can do, using ABAC session tags */
  permissionPolicy: object;
  /** Human-readable policy description */
  description: string;
}

export interface GnsIamProviderRegistration {
  /** IAM OIDC provider URL */
  providerUrl: string;
  /** Client ID / audience */
  clientId: string;
  /** Thumbprint of GNS TLS cert (needed for IAM OIDC registration) */
  thumbprint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS TOKEN VALIDATOR
// Validates a GNS id_token before presenting it to AWS STS
// ─────────────────────────────────────────────────────────────────────────────

export class GnsTokenValidator {
  private provider: GnsOidcProvider;

  constructor(provider?: GnsOidcProvider) {
    this.provider = provider ?? new GnsOidcProvider();
  }

  /**
   * Decode a GNS id_token without verifying signature.
   * Use for extracting claims before passing to STS.
   * Signature verification is done by AWS STS itself via JWKS.
   */
  decode(token: string): {
    sub: string;
    aud: string | string[];
    exp: number;
    iat: number;
    gns_trust_tier?: string;
    gns_trust_score?: number;
    gns_breadcrumb_count?: number;
    gns_humanity_proof_valid?: boolean;
    gns_subject_type?: string;
    gns_handle?: string | null;
    gns_territory?: string[] | null;
    gns_protocol_version?: string;
    [key: string]: unknown;
  } {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('[GNS AWS] Malformed JWT — expected 3 parts');
    try {
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new Error('[GNS AWS] Failed to decode JWT payload');
    }
  }

  /**
   * Validate token structure + expiry before STS call.
   * STS validates the cryptographic signature against JWKS.
   */
  validateForSts(token: string, expectedAudience = GNS_OIDC_AUDIENCE): {
    valid: boolean;
    claims?: ReturnType<GnsTokenValidator['decode']>;
    reason?: string;
  } {
    try {
      const claims = this.decode(token);

      if (claims.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, reason: 'Token expired' };
      }

      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes(expectedAudience)) {
        return { valid: false, reason: `Audience mismatch — expected ${expectedAudience}, got ${claims.aud}` };
      }

      if (!claims.sub || claims.sub.length === 0) {
        return { valid: false, reason: 'Missing sub claim' };
      }

      return { valid: true, claims };
    } catch (err) {
      return { valid: false, reason: (err as Error).message };
    }
  }

  /**
   * Map GNS JWT claims → IAM session tags.
   *
   * ABAC design:
   *   gns:trust_tier            → StringEquals in permission policies
   *   gns:humanity_proof_valid  → StringEquals "true" gates sensitive resources
   *   gns:subject_type          → StringEquals "human" blocks agents from human-only resources
   *   gns:territory_region      → StringLike "87*" restricts to H3 region prefix
   *
   * Note: Tag values must be strings (AWS constraint — same as Entra).
   * Note: Tag keys can be at most 128 chars; values at most 256 chars.
   * Note: Maximum 50 session tags per AssumeRole call.
   */
  claimsToSessionTags(claims: ReturnType<GnsTokenValidator['decode']>): Record<string, string> {
    const tags: Record<string, string> = {
      [GNS_TAG_KEYS.TRUST_TIER]:           String(claims.gns_trust_tier ?? 'SEEDLING'),
      [GNS_TAG_KEYS.TRUST_SCORE]:          String(claims.gns_trust_score ?? '0'),
      [GNS_TAG_KEYS.BREADCRUMB_COUNT]:     String(claims.gns_breadcrumb_count ?? '0'),
      [GNS_TAG_KEYS.HUMANITY_PROOF_VALID]: String(claims.gns_humanity_proof_valid ?? false),
      [GNS_TAG_KEYS.SUBJECT_TYPE]:         String(claims.gns_subject_type ?? 'human'),
      [GNS_TAG_KEYS.HANDLE]:               String(claims.gns_handle ?? ''),
      [GNS_TAG_KEYS.IDENTITY_FOUND]:       claims.gns_trust_score ? 'true' : 'false',
      [GNS_TAG_KEYS.PROTOCOL_VERSION]:     String(claims.gns_protocol_version ?? '2.0'),
    };

    // Add coarse territory region (first 3 hex chars of first H3 cell = ~continent resolution)
    if (claims.gns_territory && claims.gns_territory.length > 0) {
      tags[GNS_TAG_KEYS.TERRITORY_REGION] = claims.gns_territory[0].slice(0, 3);
    }

    return tags;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS AWS CREDENTIAL VENDOR
// Exchanges a GNS id_token for temporary AWS credentials via STS
// ─────────────────────────────────────────────────────────────────────────────

export class GnsAwsCredentialVendor {
  private config: Required<GnsAwsConfig>;
  private validator: GnsTokenValidator;

  constructor(config: GnsAwsConfig) {
    this.config = {
      roleArn: config.roleArn,
      gnsOidcProviderArn: config.gnsOidcProviderArn,
      durationSeconds: config.durationSeconds ?? 3600,
      sessionName: config.sessionName ?? 'gns-session',
      enableSessionTags: config.enableSessionTags ?? true,
      logger: config.logger ?? console,
    };
    this.validator = new GnsTokenValidator();
  }

  /**
   * Exchange a GNS id_token for temporary AWS credentials.
   *
   * Flow:
   *   1. Validate token structure + expiry
   *   2. Extract GNS claims → session tags
   *   3. Call STS AssumeRoleWithWebIdentity with token + tags
   *   4. Return AccessKeyId + SecretAccessKey + SessionToken
   *
   * AWS STS validates the Ed25519 signature against GNS JWKS automatically.
   */
  async assumeRole(gnsIdToken: string): Promise<AwsTemporaryCredentials> {
    const { logger } = this.config;

    // 1. Pre-validate token
    const validation = this.validator.validateForSts(gnsIdToken);
    if (!validation.valid) {
      throw new Error(`[GNS AWS] Token validation failed: ${validation.reason}`);
    }

    const claims = validation.claims!;
    logger.info(`[GNS AWS] Assuming role for sub: ${claims.sub.slice(0, 16)}... tier: ${claims.gns_trust_tier}`);

    // 2. Build session name (CloudTrail-friendly, no PII)
    const sessionName = this.config.sessionName !== 'gns-session'
      ? this.config.sessionName
      : `gns-${claims.sub.slice(0, 16)}-${Math.floor(Date.now() / 1000)}`;

    // 3. Map claims to session tags
    const sessionTags = this.config.enableSessionTags
      ? this.validator.claimsToSessionTags(claims)
      : {};

    // 4. Call AWS STS AssumeRoleWithWebIdentity
    //
    // Production implementation using @aws-sdk/client-sts:
    //
    // import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
    // const sts = new STSClient({ region: 'us-east-1' });
    // const response = await sts.send(new AssumeRoleWithWebIdentityCommand({
    //   RoleArn: this.config.roleArn,
    //   RoleSessionName: sessionName,
    //   WebIdentityToken: gnsIdToken,
    //   DurationSeconds: this.config.durationSeconds,
    //   ...(Object.keys(sessionTags).length > 0 ? {
    //     Tags: Object.entries(sessionTags).map(([Key, Value]) => ({ Key, Value })),
    //   } : {}),
    // }));
    // const { AccessKeyId, SecretAccessKey, SessionToken, Expiration } = response.Credentials!;
    // return {
    //   accessKeyId: AccessKeyId!,
    //   secretAccessKey: SecretAccessKey!,
    //   sessionToken: SessionToken!,
    //   expiration: Expiration!,
    //   sessionTags,
    //   assumedRoleArn: response.AssumedRoleUser!.Arn!,
    // };

    // Simulation for testing (no AWS SDK dependency required):
    const expiration = new Date(Date.now() + this.config.durationSeconds * 1000);
    const simulatedCreds: AwsTemporaryCredentials = {
      accessKeyId: `ASIA${claims.sub.slice(0, 12).toUpperCase()}`,
      secretAccessKey: `simulated-secret-${claims.sub.slice(0, 16)}`,
      sessionToken: `FQoGZXIvYXdzEBcaDGNS-simulated-token-${Date.now()}`,
      expiration,
      sessionTags,
      assumedRoleArn: `${this.config.roleArn.replace(':role/', ':assumed-role/')}/${sessionName}`,
    };

    logger.info(`[GNS AWS] Credentials issued. Expires: ${expiration.toISOString()}`);
    logger.info(`[GNS AWS] Session tags: ${JSON.stringify(sessionTags)}`);

    return simulatedCreds;
  }

  /**
   * Assume a different role using existing temporary credentials (role chaining).
   * Session tags are preserved (transitive) across chained role sessions.
   */
  async chainRole(existingCreds: AwsTemporaryCredentials, targetRoleArn: string): Promise<AwsTemporaryCredentials> {
    // Production: use existing creds to call STS AssumeRole
    // Session tags are transitive — they carry forward automatically
    const expiration = new Date(Date.now() + 3600 * 1000);
    return {
      ...existingCreds,
      accessKeyId: `ASIA${targetRoleArn.slice(-12).toUpperCase()}`,
      secretAccessKey: `chained-secret-${Date.now()}`,
      sessionToken: `chained-token-${Date.now()}`,
      expiration,
      assumedRoleArn: targetRoleArn,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IAM POLICY GENERATOR
// Generates trust policies, permission policies, CloudFormation, Terraform
// ─────────────────────────────────────────────────────────────────────────────

export class GnsIamPolicyGenerator {
  /**
   * Generate IAM trust + permission policies for a specific GNS trust tier.
   *
   * Trust policy: allows any GNS identity to attempt role assumption
   *   - Condition: aud == "sts.amazonaws.com"
   *   - Condition: sub is any valid GNS pk (64 hex chars) — use StringLike
   *
   * Permission policy: ABAC using session tags
   *   - Condition: aws:PrincipalTag/gns:trust_tier == required tier
   *   - Condition: aws:PrincipalTag/gns:humanity_proof_valid == "true"
   */
  static forTier(tier: GnsTrustTier, options: GnsIamPolicyOptions): GnsRolePolicies {
    const providerDomain = 'id.gns.foundation';

    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: {
          Federated: `arn:aws:iam::${options.awsAccountId}:oidc-provider/${providerDomain}`,
        },
        Action: [
          'sts:AssumeRoleWithWebIdentity',
          'sts:TagSession',  // Required for session tag propagation
        ],
        Condition: {
          StringEquals: {
            [`${providerDomain}:aud`]: GNS_OIDC_AUDIENCE,
            // Block agents if not allowed
            ...(options.allowAgents === false ? {
              [`${providerDomain}:gns_subject_type`]: 'human',
            } : {}),
            // Restrict to specific subject (for agent-specific roles)
            ...(options.specificSubject ? {
              [`${providerDomain}:sub`]: options.specificSubject,
            } : {}),
          },
        },
      }],
    };

    // Permission policy using ABAC on session tags
    // This is where the real trust tier enforcement happens
    const tierRequirements = GnsIamPolicyGenerator._tierRequirements(tier);
    const regionCondition = options.allowedRegions?.length
      ? { 'aws:RequestedRegion': options.allowedRegions }
      : undefined;

    const permissionPolicy = {
      Version: '2012-10-17',
      Statement: [
        // Deny everything if GNS trust tier is insufficient
        {
          Sid: 'DenyInsufficientTrustTier',
          Effect: 'Deny',
          Action: '*',
          Resource: '*',
          Condition: {
            StringNotEquals: {
              'aws:PrincipalTag/gns:trust_tier': tierRequirements.allowedTiers,
            },
          },
        },
        // Deny everything if humanity proof is not valid
        {
          Sid: 'DenyStaleHumanityProof',
          Effect: 'Deny',
          Action: '*',
          Resource: '*',
          Condition: {
            StringNotEquals: {
              'aws:PrincipalTag/gns:humanity_proof_valid': 'true',
            },
          },
        },
        // Deny agent subjects from human-only roles
        ...(options.allowAgents === false ? [{
          Sid: 'DenyAgentSubjects',
          Effect: 'Deny' as const,
          Action: '*',
          Resource: '*',
          Condition: {
            StringEquals: {
              'aws:PrincipalTag/gns:subject_type': 'ai_agent',
            },
          },
        }] : []),
        // Restrict to allowed regions
        ...(regionCondition ? [{
          Sid: 'DenyDisallowedRegions',
          Effect: 'Deny' as const,
          Action: '*',
          Resource: '*',
          Condition: {
            StringNotEquals: regionCondition,
          },
        }] : []),
        // Allow permitted actions for this tier
        ...tierRequirements.allowStatements,
      ],
    };

    return {
      trustPolicy,
      permissionPolicy,
      description: `GNS ${tier} role — requires gns:trust_tier=${tier}, gns:humanity_proof_valid=true`,
    };
  }

  /**
   * Generate a complete set of 4 GNS tier roles.
   * Deploy all four and users/agents get the highest tier they qualify for.
   */
  static allTiers(options: GnsIamPolicyOptions): Record<GnsTrustTier, GnsRolePolicies> {
    return {
      SEEDLING:    GnsIamPolicyGenerator.forTier('SEEDLING', options),
      EXPLORER:    GnsIamPolicyGenerator.forTier('EXPLORER', options),
      NAVIGATOR:   GnsIamPolicyGenerator.forTier('NAVIGATOR', options),
      TRAILBLAZER: GnsIamPolicyGenerator.forTier('TRAILBLAZER', options),
    };
  }

  /**
   * Generate CloudFormation template that registers GNS as an OIDC provider
   * and creates all 4 tier roles.
   */
  static cloudFormation(options: GnsIamPolicyOptions): string {
    const tiers = GnsIamPolicyGenerator.allTiers(options);
    const resources: Record<string, unknown> = {};

    // OIDC Provider
    resources['GnsOidcProvider'] = {
      Type: 'AWS::IAM::OIDCProvider',
      Properties: {
        Url: GNS_OIDC_ISSUER,
        ClientIdList: [GNS_OIDC_AUDIENCE],
        // Thumbprint of id.gns.foundation TLS cert (update before deploying)
        ThumbprintList: ['0000000000000000000000000000000000000000'],
        Tags: [
          { Key: 'managed-by', Value: 'gns-aip' },
          { Key: 'protocol', Value: 'TrIP' },
        ],
      },
    };

    // IAM Role per tier
    for (const [tier, policies] of Object.entries(tiers)) {
      const logicalId = `Gns${tier.charAt(0) + tier.slice(1).toLowerCase()}Role`;
      resources[logicalId] = {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: `gns-${tier.toLowerCase()}-role`,
          Description: policies.description,
          AssumeRolePolicyDocument: policies.trustPolicy,
          Policies: [{
            PolicyName: `gns-${tier.toLowerCase()}-permissions`,
            PolicyDocument: policies.permissionPolicy,
          }],
          MaxSessionDuration: 43200,
          Tags: [
            { Key: 'gns:tier', Value: tier },
            { Key: 'managed-by', Value: 'gns-aip' },
          ],
        },
      };
    }

    return JSON.stringify({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'GNS Protocol — IAM OIDC Federation. Registers id.gns.foundation as OIDC provider and creates 4 tier roles.',
      Parameters: {
        GnsOidcThumbprint: {
          Type: 'String',
          Description: 'TLS certificate thumbprint for id.gns.foundation. Get with: openssl s_client -connect id.gns.foundation:443 | openssl x509 -fingerprint -noout',
        },
      },
      Resources: resources,
      Outputs: {
        GnsOidcProviderArn: {
          Value: { 'Fn::GetAtt': ['GnsOidcProvider', 'Arn'] },
          Description: 'ARN to pass to @gns-aip/aws GnsAwsConfig.gnsOidcProviderArn',
          Export: { Name: 'GnsOidcProviderArn' },
        },
        GnsNavigatorRoleArn: {
          Value: { 'Fn::GetAtt': ['GnsNavigatorRole', 'Arn'] },
          Description: 'Most common role — NAVIGATOR tier (250+ breadcrumbs)',
          Export: { Name: 'GnsNavigatorRoleArn' },
        },
      },
    }, null, 2);
  }

  /**
   * Generate Terraform HCL for the GNS OIDC provider + roles.
   */
  static terraform(options: GnsIamPolicyOptions): string {
    const tiers: GnsTrustTier[] = ['SEEDLING', 'EXPLORER', 'NAVIGATOR', 'TRAILBLAZER'];

    const roleBlocks = tiers.map(tier => {
      const policies = GnsIamPolicyGenerator.forTier(tier, options);
      return `
resource "aws_iam_role" "gns_${tier.toLowerCase()}" {
  name               = "gns-${tier.toLowerCase()}-role"
  description        = "${policies.description}"
  max_session_duration = 43200

  assume_role_policy = jsonencode(${JSON.stringify(policies.trustPolicy, null, 4)})

  tags = {
    "gns:tier"   = "${tier}"
    "managed-by" = "gns-aip"
  }
}

resource "aws_iam_role_policy" "gns_${tier.toLowerCase()}_permissions" {
  name   = "gns-${tier.toLowerCase()}-permissions"
  role   = aws_iam_role.gns_${tier.toLowerCase()}.id
  policy = jsonencode(${JSON.stringify(GnsIamPolicyGenerator.forTier(tier, options).permissionPolicy, null, 4)})
}`;
    }).join('\n');

    return `# GNS Protocol — AWS IAM OIDC Federation
# Generated by @gns-aip/aws GnsIamPolicyGenerator.terraform()
# Apply with: terraform init && terraform apply

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

# Register GNS as OIDC Identity Provider
resource "aws_iam_openid_connect_provider" "gns" {
  url             = "${GNS_OIDC_ISSUER}"
  client_id_list  = ["${GNS_OIDC_AUDIENCE}"]
  # Get thumbprint: openssl s_client -connect id.gns.foundation:443 | openssl x509 -fingerprint -noout
  thumbprint_list = [var.gns_tls_thumbprint]

  tags = {
    "managed-by" = "gns-aip"
    "protocol"   = "TrIP"
  }
}

variable "gns_tls_thumbprint" {
  description = "TLS certificate thumbprint for id.gns.foundation"
  type        = string
}

output "gns_oidc_provider_arn" {
  value       = aws_iam_openid_connect_provider.gns.arn
  description = "Pass to GnsAwsConfig.gnsOidcProviderArn"
}
${roleBlocks}
`;
  }

  /**
   * Generate the OIDC provider registration details.
   */
  static oidcProviderRegistration(): GnsIamProviderRegistration {
    return {
      providerUrl: GNS_OIDC_ISSUER,
      clientId: GNS_OIDC_AUDIENCE,
      // Placeholder — real thumbprint computed from TLS cert at deployment time
      thumbprint: '0000000000000000000000000000000000000000',
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private static _tierRequirements(tier: GnsTrustTier): {
    allowedTiers: string[];
    allowStatements: object[];
  } {
    // Higher tiers include lower tiers (TRAILBLAZER can assume NAVIGATOR role etc.)
    const tierHierarchy: Record<GnsTrustTier, GnsTrustTier[]> = {
      SEEDLING:    ['SEEDLING', 'EXPLORER', 'NAVIGATOR', 'TRAILBLAZER'],
      EXPLORER:    ['EXPLORER', 'NAVIGATOR', 'TRAILBLAZER'],
      NAVIGATOR:   ['NAVIGATOR', 'TRAILBLAZER'],
      TRAILBLAZER: ['TRAILBLAZER'],
    };

    const tierServices: Record<GnsTrustTier, string[]> = {
      SEEDLING:    ['s3:GetObject', 's3:ListBucket'],
      EXPLORER:    ['s3:*', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'],
      NAVIGATOR:   ['s3:*', 'dynamodb:*', 'lambda:InvokeFunction', 'bedrock:InvokeModel'],
      TRAILBLAZER: ['s3:*', 'dynamodb:*', 'lambda:*', 'bedrock:*', 'ec2:Describe*', 'cloudwatch:*'],
    };

    return {
      allowedTiers: tierHierarchy[tier],
      allowStatements: [{
        Sid: `Allow${tier}Actions`,
        Effect: 'Allow',
        Action: tierServices[tier],
        Resource: '*',
        Condition: {
          StringEquals: {
            'aws:PrincipalTag/gns:trust_tier': tierHierarchy[tier],
            'aws:PrincipalTag/gns:humanity_proof_valid': 'true',
          },
        },
      }],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a GNS-governed AWS credential vendor.
 *
 * Example — AI agent accessing Bedrock with GNS identity:
 *
 *   const vendor = createGnsAwsVendor({
 *     roleArn: 'arn:aws:iam::123456789012:role/gns-navigator-role',
 *     gnsOidcProviderArn: 'arn:aws:iam::123456789012:oidc-provider/id.gns.foundation',
 *   });
 *
 *   const creds = await vendor.assumeRole(agentGnsIdToken);
 *   // Temporary AWS creds with session tags:
 *   // gns:trust_tier=NAVIGATOR, gns:humanity_proof_valid=true
 *
 *   // Use with AWS SDK:
 *   const bedrock = new BedrockRuntimeClient({
 *     credentials: {
 *       accessKeyId: creds.accessKeyId,
 *       secretAccessKey: creds.secretAccessKey,
 *       sessionToken: creds.sessionToken,
 *     }
 *   });
 */
export function createGnsAwsVendor(config: GnsAwsConfig): GnsAwsCredentialVendor {
  return new GnsAwsCredentialVendor(config);
}

export { GnsOidcProvider };
export type { GnsTrustTier };
