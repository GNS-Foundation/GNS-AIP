# TypeScript Types

## ComplianceTier

```typescript
type ComplianceTier = 'SHADOW' | 'BASIC' | 'VERIFIED' | 'TRUSTED' | 'SOVEREIGN';
```

## DelegationScope

```typescript
interface DelegationScope {
  actions: string[];    // ['search', 'code'] or ['*']
  resources: string[];  // ['public-data'] or ['*']
}
```

## DelegationCert

```typescript
interface DelegationCert {
  certHash: string;
  delegatorPk: string;
  delegatePk: string;
  chainDepth: number;
  scope: DelegationScope;
  territory: string[];
  issuedAt: string;
  expiresAt?: string;
  isActive: boolean;
}
```

## AgentManifest

```typescript
interface AgentManifest {
  agentId: string;
  agentHandle?: string;
  homeCells: string[];
  delegationChain: DelegationCert[];
}
```

## ComplianceScore

```typescript
interface ComplianceScore {
  total: number;         // 0-100
  tier: ComplianceTier;
  delegation: number;    // 0-25
  territory: number;     // 0-25
  history: number;       // 0-25
  staking: number;       // 0-25
  delegationValid: boolean;
}
```

## Breadcrumb

```typescript
interface Breadcrumb {
  h3Cell: string;
  operationType: string;
  operationHash: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```
