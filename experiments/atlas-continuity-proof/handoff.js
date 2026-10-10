'use strict';

const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const [,, inputPath, outputPath, expectedText] = process.argv;
if (!inputPath || !outputPath || !expectedText) throw new Error('usage: node handoff.js <input> <output> <expected-generation>');

const expected = Number(expectedText);
const state = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (state.schema !== 'atlas-continuity-proof/v1') throw new Error('bad schema');
if (!Number.isInteger(state.generation)) throw new Error('bad generation');
if (state.generation + 1 !== expected) throw new Error('generation mismatch');

const parentDigest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
const receipt = {
  schema: 'atlas-runner-handoff/v1',
  generation_before: state.generation,
  generation_after: expected,
  workflow_run_id: process.env.GITHUB_RUN_ID || null,
  job: process.env.GITHUB_JOB || null,
  runner_name: process.env.RUNNER_NAME || null,
  runner_os: process.env.RUNNER_OS || null,
  hostname: os.hostname(),
  parent_digest: parentDigest,
  observed_at: new Date().toISOString()
};
const next = {...state,generation:expected,last_heartbeat_at:receipt.observed_at,lineage:[...(state.lineage||[]),receipt]};
fs.writeFileSync(outputPath, JSON.stringify(next,null,2)+'\n');
console.log('ATLAS_HANDOFF generation='+expected+' job='+receipt.job+' host='+receipt.hostname);
