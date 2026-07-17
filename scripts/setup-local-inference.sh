#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-local-inference.sh — install the OPTIONAL in-process inference engine so
# the library can run its small functional model(s) itself (a self-contained
# reasoning appliance; see docs/usage.md "Embedded inference"). NOTHING here is
# committed: node-llama-cpp's native build lands in the gitignored node_modules,
# and GGUF models live in the gitignored models/ dir. Run this only if you want
# local models — the base library never needs it.
#
#   npm run local-inference:setup                 # install the engine (bundled llama.cpp build)
#   npm run local-inference:setup -- --turboquant # + guidance for the TurboQuant+ fork
#
# Then drop a GGUF into models/ (or symlink one) and point the provider at it:
#   LOCAL_MODEL=models/your-model.gguf node your-app.js
#   # or: makeLocalAsk({ modelPath: 'models/your-model.gguf' })
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
NLC_VERSION="^3.19.0"
WANT_TURBOQUANT=0
for arg in "$@"; do [ "$arg" = "--turboquant" ] && WANT_TURBOQUANT=1; done

echo "→ installing node-llama-cpp ${NLC_VERSION} (native, GPU auto-detected; not saved to package.json, not committed)…"
npm install --no-save --no-audit --no-fund "node-llama-cpp@${NLC_VERSION}"

echo "→ creating the gitignored models/ dir (drop your .gguf files here, or symlink them)…"
mkdir -p models

if [ "$WANT_TURBOQUANT" = "1" ]; then
  cat <<'TQ'

── TurboQuant+ (TheTom/llama-cpp-turboquant) ──────────────────────────────────
Two ways to use the TurboQuant+ codec (needs models quantized in TQ formats via
the fork's llama-quantize to actually invoke the codec):

  A. IMMEDIATE, zero integration risk — run the fork's llama-server (already a
     standard OpenAI-compatible endpoint) and reach it via the HTTP provider:
       <fork>/build/bin/llama-server -m models/your-TQ-model.gguf --port 5001
       createLLMProvider({ ask: makeOpenAIAsk({ base: 'http://localhost:5001' }) })

  B. IN-PROCESS, experimental — build node-llama-cpp's addon against the fork:
       npx --yes node-llama-cpp source download --repo TheTom/llama-cpp-turboquant --release <ref>
     then it compiles the addon. CAVEAT: node-llama-cpp's binding targets a
     specific llama.cpp API version — if the fork has drifted, the addon won't
     compile; fall back to (A) or the bundled build. Verify with a build attempt.
───────────────────────────────────────────────────────────────────────────────
TQ
fi

echo "✓ done. Quick check:  node -e \"require('node-llama-cpp')\" && echo engine-ok"
echo "  Default backend = the bundled llama.cpp build (standard GGUF quants), proven on the RTX-class GPU."
