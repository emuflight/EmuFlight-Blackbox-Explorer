#!/usr/bin/env node
// Cross-platform git hook setup
// Detects OS and runs appropriate setup script

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../../');
const platform = process.platform;

console.log('[INFO] Setting up git pre-commit hook...');
  console.log(`[PLATFORM] ${platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'}`);

try {
  // Resolve via git itself, not a hardcoded '.git/hooks' join — a worktree's
  // '.git' is a file, not a directory, and its real hooks dir lives in the
  // main checkout's .git (shared across all worktrees of the same repo).
  const hooksDir = execSync('git rev-parse --git-path hooks', { cwd: projectRoot, encoding: 'utf8' }).trim();
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Copy hook script to .git/hooks
  const hookSource = path.join(projectRoot, '.github', 'scripts', 'pre-commit-hook.sh');
  const hookDest = path.join(hooksDir, 'pre-commit');

  // Back up existing hook if it exists and is not our source
  if (fs.existsSync(hookDest)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = `${hookDest}.bak.${timestamp}`;
    fs.copyFileSync(hookDest, backupPath);
    console.log(`[INFO] Backed up existing hook to ${path.basename(backupPath)}`);
  }

  const hookContent = fs.readFileSync(hookSource, 'utf8');
  fs.writeFileSync(hookDest, hookContent);

  // Make hook executable on Unix-like systems
  if (platform !== 'win32') {
    fs.chmodSync(hookDest, 0o755);
  }

  console.log('[OK] Hook installed at .git/hooks/pre-commit');
  console.log('[INFO] Testing the hook on your next commit...');
  process.exit(0);
} catch (error) {
  console.error('[ERROR] Setup failed:', error.message);
  process.exit(1);
}
