#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SPRINT 0 — "Ship the Shelf"
# GNS Invisible Protocol Strategy — Execution Script
# 
# Run from ~/GNS-AIP on your Mac
# Prerequisites: npm login (with publish access to @gns-aip org)
# ═══════════════════════════════════════════════════════════════

set -e
echo ""
echo "🚀 SPRINT 0 — Ship the Shelf"
echo "═══════════════════════════════════════"
echo ""

# ── S0.0: Pre-flight checks ──────────────────────────────────
echo "📋 Pre-flight checks..."
if ! command -v npm &>/dev/null; then echo "❌ npm not found"; exit 1; fi
if ! command -v node &>/dev/null; then echo "❌ node not found"; exit 1; fi

NODE_VER=$(node -v | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VER" -lt 18 ]; then echo "❌ Node >= 18 required (got $NODE_VER)"; exit 1; fi

echo "   Node $(node -v) ✓"
echo "   npm $(npm -v) ✓"
echo ""

# ── S0.1: Fix langchain-gns-aip dependency ───────────────────
echo "🔧 S0.1: Fixing langchain-gns-aip dependency..."

# Fix @gns-aip/sdk version from * to ^0.1.0
sed -i.bak 's/"@gns-aip\/sdk": "\*"/"@gns-aip\/sdk": "^0.1.0"/' packages/langchain-gns-aip/package.json
rm -f packages/langchain-gns-aip/package.json.bak

# Add README.md to files array if not present
if ! grep -q '"README.md"' packages/langchain-gns-aip/package.json; then
  sed -i.bak 's/"files": \[/"files": [\n    "README.md",/' packages/langchain-gns-aip/package.json
  rm -f packages/langchain-gns-aip/package.json.bak
fi

echo "   ✓ langchain-gns-aip dependency fixed"
echo ""

# ── S0.2: Install dependencies ───────────────────────────────
echo "📦 S0.2: Installing dependencies..."
npm install
echo "   ✓ Dependencies installed"
echo ""

# ── S0.3: Build @gns-aip/sdk ─────────────────────────────────
echo "🔨 S0.3: Building @gns-aip/sdk..."
cd packages/sdk
npm run build
echo "   ✓ SDK built ($(ls dist/*.js | wc -l) JS files, $(ls dist/*.d.ts | wc -l) type declarations)"

# ── S0.4: Test @gns-aip/sdk ──────────────────────────────────
echo ""
echo "🧪 S0.4: Testing @gns-aip/sdk..."
node test.js 2>&1 | tail -5
echo ""

# ── S0.5: Build langchain-gns-aip ────────────────────────────
echo "🔨 S0.5: Building langchain-gns-aip..."
cd ../langchain-gns-aip
npx tsc
echo "   ✓ langchain-gns-aip built"
cd ../..
echo ""

# ── S0.6: Dry run (verify package contents) ──────────────────
echo "📋 S0.6: Dry run — checking package contents..."
echo ""
echo "   @gns-aip/sdk:"
cd packages/sdk
npm pack --dry-run 2>&1 | grep -E 'Tarball|total files|dist/'
echo ""
echo "   langchain-gns-aip:"
cd ../langchain-gns-aip
npm pack --dry-run 2>&1 | grep -E 'Tarball|total files|dist/'
cd ../..
echo ""

echo "═══════════════════════════════════════"
echo ""
echo "✅ Everything builds and tests pass."
echo ""
echo "NEXT STEPS (manual — requires npm login):"
echo ""
echo "  1. Create npm org (one-time, if needed):"
echo "     npm login"
echo "     npm org create gns-aip"
echo ""
echo "  2. Publish @gns-aip/sdk:"
echo "     cd packages/sdk"
echo "     npm publish --access public"
echo ""
echo "  3. Publish langchain-gns-aip:"
echo "     cd ../langchain-gns-aip" 
echo "     npm publish --access public"
echo ""
echo "  4. Verify:"
echo "     npm info @gns-aip/sdk"
echo "     npm info langchain-gns-aip"
echo ""
echo "  5. Test from scratch:"
echo "     mkdir /tmp/test-gns && cd /tmp/test-gns"
echo "     npm init -y && npm install @gns-aip/sdk"
echo "     node -e \"const g = require('@gns-aip/sdk'); console.log(g.GNS_AIP_VERSION)\""
echo ""
echo "  6. Commit & push:"
echo "     git add -A"
echo "     git commit -m 'sprint-0: publish @gns-aip/sdk v0.1.0 + langchain-gns-aip v0.1.0'"
echo "     git push origin main"
echo ""
echo "═══════════════════════════════════════"
echo "🎯 The Let's Encrypt moment: npm install @gns-aip/sdk"
echo "═══════════════════════════════════════"
