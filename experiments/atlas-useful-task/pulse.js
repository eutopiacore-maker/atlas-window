'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = process.cwd();
const BASE = path.join(ROOT, 'experiments', 'atlas-useful-task');
const STATE_PATH = path.join(BASE, 'state.json');
const REPORT_PATH = path.join(BASE, 'report.json');
const generation = Number(process.env.EXPECTED_GENERATION || '1');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function isLocalRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return false;
  return !/^(?:[a-z]+:|\/\/|#)/i.test(s);
}

function normalizeTarget(file, ref) {
  const clean = String(ref).split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('/')) return path.join(ROOT, clean.replace(/^\/+/, ''));
  return path.resolve(path.dirname(file), clean);
}

function relative(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

const state = readJson(STATE_PATH);
if (state.schema !== 'atlas-useful-task-state/v1') throw new Error('bad state schema');

if (generation === 1) {
  if (state.status !== 'PENDING') throw new Error('generation 1 expected PENDING state');

  const htmlFiles = walk(ROOT).filter(f => f.toLowerCase().endsWith('.html'));
  const checked = [];
  const broken = [];

  const attrRe = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;

  for (const file of htmlFiles) {
    const text = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = attrRe.exec(text)) !== null) {
      const ref = match[1];
      if (!isLocalRef(ref)) continue;
      const target = normalizeTarget(file, ref);
      if (!target) continue;
      const item = {
        source: relative(file),
        ref,
        resolved: relative(target),
        exists: fs.existsSync(target)
      };
      checked.push(item);
      if (!item.exists) broken.push(item);
    }
  }

  const report = {
    schema: 'atlas-useful-task-report/v1',
    task_id: state.task_id,
    generated_at: new Date().toISOString(),
    workflow_run_id: process.env.GITHUB_RUN_ID || null,
    runner_name: process.env.RUNNER_NAME || null,
    html_files_scanned: htmlFiles.length,
    local_references_checked: checked.length,
    broken_reference_count: broken.length,
    broken_references: broken
  };

  const reportText = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(REPORT_PATH, reportText);

  state.status = 'COMPLETED';
  state.audit_run_count += 1;
  state.result_ref = 'experiments/atlas-useful-task/report.json';
  state.result_sha256 = sha256(reportText);
  state.history.push({
    generation,
    event: 'TASK_EXECUTED',
    run_id: process.env.GITHUB_RUN_ID || null,
    at: new Date().toISOString()
  });
  writeJson(STATE_PATH, state);

  console.log('ATLAS_USEFUL_TASK_EXECUTED=True');
  console.log('ATLAS_HTML_FILES_SCANNED=' + report.html_files_scanned);
  console.log('ATLAS_LOCAL_REFERENCES_CHECKED=' + report.local_references_checked);
  console.log('ATLAS_BROKEN_REFERENCE_COUNT=' + report.broken_reference_count);
  process.exit(0);
}

if (generation === 2) {
  if (state.status !== 'COMPLETED') throw new Error('generation 2 expected COMPLETED state');
  if (state.audit_run_count !== 1) throw new Error('task was executed more than once');
  if (!fs.existsSync(REPORT_PATH)) throw new Error('report missing');

  const reportText = fs.readFileSync(REPORT_PATH, 'utf8');
  const observedSha = sha256(reportText);
  if (observedSha !== state.result_sha256) throw new Error('report hash mismatch');

  const report = JSON.parse(reportText);
  state.status = 'VERIFIED';
  state.verification = {
    status: 'PASS',
    verified_generation: generation,
    verified_run_id: process.env.GITHUB_RUN_ID || null,
    report_sha256: observedSha,
    audit_run_count_observed: state.audit_run_count,
    broken_reference_count: report.broken_reference_count
  };
  state.history.push({
    generation,
    event: 'PRIOR_COMPLETION_RECOGNIZED_AND_VERIFIED',
    run_id: process.env.GITHUB_RUN_ID || null,
    at: new Date().toISOString()
  });
  writeJson(STATE_PATH, state);

  console.log('ATLAS_USEFUL_TASK_REEXECUTED=False');
  console.log('ATLAS_PRIOR_COMPLETION_RECOGNIZED=True');
  console.log('ATLAS_RESULT_VERIFIED=True');
  console.log('ATLAS_BROKEN_REFERENCE_COUNT=' + report.broken_reference_count);
  process.exit(0);
}

throw new Error('unsupported generation ' + generation);
