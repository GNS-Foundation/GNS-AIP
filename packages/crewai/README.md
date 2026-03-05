# @gns-aip/crewai

> GNS-AIP integration for CrewAI — maps Manager/Worker crew patterns onto cryptographic delegation chains with EU AI Act HITL compliance.

## The Key Insight

CrewAI's Manager/Worker pattern and GNS-AIP's delegation chain model are **isomorphic**:

```
CrewAI                    GNS-AIP
──────────────────        ──────────────────────────────────────────
Human (you)          →    Human Principal (Ed25519 keypair, root)
Manager Agent        →    Depth-2 cert: Human → Manager (signed by you)
Worker Agent 0       →    Depth-1 cert: Manager → Worker 0 (signed by manager)
Worker Agent 1       →    Depth-1 cert: Manager → Worker 1 (signed by manager)
Task execution       →    Breadcrumb dropped per tool call
Crew final output    →    Compliance report (EU AI Act Art 13/14/17)
```

Every crew operation is now cryptographically provable back to you.

## Install

```bash
npm install @gns-aip/crewai @gns-aip/sdk
```

## Quick Start

```typescript
import { createGnsCrew } from '@gns-aip/crewai';
import nacl from 'tweetnacl';

const humanKeypair = nacl.sign.keyPair(); // stored on mobile in production

const crew = await createGnsCrew({
  humanKeypair,
  territoryCells: ['871e8052affffff', '871e8050fffffff', '871e8051fffffff'],

  manager: {
    role: 'Grid Operations Manager',
    goal: 'Coordinate monitoring of Rome electricity grid',
    tools: [summaryTool],
    riskLevel: 'HIGH',
  },

  workers: [
    {
      role: 'Sensor Data Fetcher',
      goal: 'Retrieve real-time telemetry from substations',
      tools: [sensorTool],
      facets: ['read', 'telemetry'],
      riskLevel: 'LOW',
    },
    {
      role: 'Anomaly Detector',
      goal: 'Detect voltage anomalies in sensor data',
      tools: [analysisTool],
      facets: ['read', 'execute'],
      riskLevel: 'MEDIUM',
    },
  ],

  tasks: [
    {
      description: 'Fetch current grid load for all Rome substations',
      assignTo: 'worker:0',
      requiredFacet: 'telemetry',
    },
    {
      description: 'Analyze data and flag any anomalies above 5% variance',
      assignTo: 'worker:1',
      contextPassthrough: true,
    },
    {
      description: 'Summarize findings for the human operator',
      assignTo: 'manager',
    },
  ],

  llm,
  verbose: true,
});

const result = await crew.kickoff();

console.log(result.output);
console.log(`Chain valid: ${result.delegationChainValid}`);  // true
console.log(`EU AI Act:  ${result.euAiActCompliant}`);       // true
console.log(`Breadcrumbs: ${result.totalBreadcrumbs}`);      // 3 (one per task)

// Per-agent compliance
result.agentReports.forEach(r => {
  console.log(`${r.role}: tier=${r.complianceTier}, score=${r.trustScore}`);
});
```

## Delegation Chain Verification

```typescript
// Verify a worker's full chain back to human principal
const chain = crew.getWorkerChain(0);
// [humanCert → managerCert → worker0Cert]

// Get effective permissions (intersection across chain)
const constraints = crew.getWorkerConstraints(0);
console.log(constraints.effectiveFacets);    // ['read', 'telemetry']
console.log(constraints.effectiveTerritory); // cells in both manager AND worker scope
console.log(constraints.rootPrincipal);      // human principal pk
```

## HITL Escalation

```typescript
const crew = await createGnsCrew({
  // ...
  onEscalation: async (request, agentRole) => {
    console.log(`⚠️  ${agentRole} requires human approval`);
    console.log(`   Operation: ${request.operationDescription}`);
    console.log(`   Reason: ${request.reason}`);
    // Send push notification to GCRUMBS mobile app
    // Human approves with biometric signature on phone
    await sendApprovalRequest(request);
  },
});
```

## Architecture

```
GnsCrew.kickoff()
    │
    ├── _verifyAllChains()  ← cryptographic proof before any task runs
    │
    ├── For each task:
    │     ├── _resolveAgent()    ← 'manager' | 'worker:0' | 'worker:1'
    │     ├── hitl.checkOperation()  ← EU AI Act Art 14 gate
    │     ├── tool.invoke(input, GnsCrewToolContext)
    │     │     └── context.chainHeader → X-GNS-Chain HTTP header
    │     └── _dropBreadcrumb()  ← signed proof of operation
    │
    └── _buildResult()
          ├── delegationChainValid
          ├── agentReports (per-agent compliance)
          ├── taskLog (full audit trail)
          └── euAiActCompliant
```

## GnsCrewToolContext

Each tool receives a context object:

```typescript
interface GnsCrewToolContext {
  agentPk: string;          // agent's Ed25519 public key hex
  agentRole: string;        // 'Sensor Data Fetcher'
  chainHeader: string;      // base64 — add as X-GNS-Chain HTTP header
  delegationDepth: number;  // 0 = leaf worker, N = manager
  humanPrincipalPk: string; // root human pk — for audit trail
  territoryCells: string[]; // H3 cells this agent may operate in
  operationCount: number;   // operations since last HITL auth
}
```

## Terna S.p.A. Use Case

This package was designed with Terna's AI agent governance requirements:

- **1.7M smart meters** across Italy's electricity grid
- **Multi-region crews**: one manager per region (North/Central/South)
- **Worker specialization**: telemetry fetchers, anomaly detectors, report generators
- **Human oversight**: HITL gates on every financial or control operation
- **Audit compliance**: full chain verification for regulatory reporting

```typescript
const ternaCrew = await createGnsCrew({
  humanKeypair: operatorKeypair,
  territoryCells: italianGridCells,  // H3 cells covering Italy
  manager: {
    role: 'Regional Grid Coordinator',
    goal: 'Monitor and coordinate Italian grid operations',
    riskLevel: 'HIGH',
    tools: [coordinationTool],
  },
  workers: [
    { role: 'Meter Reader',     facets: ['read', 'telemetry'], riskLevel: 'LOW',    tools: [meterTool] },
    { role: 'Fault Detector',   facets: ['read', 'execute'],   riskLevel: 'MEDIUM', tools: [faultTool] },
    { role: 'Control Actuator', facets: ['write', 'execute'],  riskLevel: 'HIGH',   tools: [controlTool] },
  ],
  tasks: [...],
});
```

## EU AI Act Compliance

| Article | Requirement | GnsCrew Implementation |
|---|---|---|
| Art 13 | Transparency | `taskLog` — signed breadcrumb per operation |
| Art 14 | Human oversight | HITL engine, `onEscalation` callback |
| Art 17 | Risk management | Per-agent `riskLevel` → escalation thresholds |
| Art 26 | Responsibilities | `humanPrincipalPk` on every cert and breadcrumb |

## License

Apache-2.0 — [GNS Foundation](https://gns.foundation)
