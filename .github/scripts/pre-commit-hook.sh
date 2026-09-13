#!/bin/bash
# Pre-commit hook for EmuFlight Blackbox Explorer
# Enforces yarn lint checks before commits
# Auto-installs dependencies if needed

set -e

# Ensure node_modules exists, install if missing
if [ ! -d "node_modules" ]; then
  echo "[INFO] Installing dependencies..."
  yarn install
fi

# Run lint check
echo "[LINT] Running lint checks..."
if yarn lint; then
  echo "[OK] Lint checks passed!"
  exit 0
else
  echo "[ERROR] Lint errors found. Please fix and try again."
  echo "[TIP] Run 'yarn lint -- --fix' to auto-fix some issues."
  exit 1
fi
