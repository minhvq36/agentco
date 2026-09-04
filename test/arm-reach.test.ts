
import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Company } from '../dist/core/company.js';

function tmpCompany(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentco-reach-'));
  fs.mkdirSync(path.join(dir, 'offices'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'company.yaml'),
    [
      'models: {}',
      'mcpServers:',
      '  a354ff2bb34:',
      '    type: http',
      '    url: https://mcp.notion.com/mcp',
      'arms:',
      '  a354ff2bb34:',
      '    label: Notion · Acme Team',
      '    secrets: [NOTION_OAUTH_52BA79B8]',
      '    tools: [notion-search, notion-fetch]',
      '',
    ].join('\n'),
    'utf8',
  );
  return dir;
}

test('🔴 0 offices ⇒ the arm is an ORPHAN (the UI relies on this flag to show the delete button)', () => {
  const dir = tmpCompany();
  try {
    const company = Company.open(dir);
    assert.equal(company.size, 0, 'precondition: the company has no offices');

    const arms = company.listArms();
    assert.equal(arms.length, 1);
    assert.equal(arms[0]?.orphan, true, 'no office holds it ⇒ it must be an orphan');
    assert.deepEqual(arms[0]?.usedBy, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 0 offices ⇒ `forgetArm` RUNS FINE, and only removes it from the ledger', () => {
  const dir = tmpCompany();
  try {
    const company = Company.open(dir);
    company.forgetArm('a354ff2bb34');

    assert.equal(company.listArms().length, 0, 'left the shared ledger');
    const yaml = fs.readFileSync(path.join(dir, 'company.yaml'), 'utf8');
    assert.ok(!yaml.includes('a354ff2bb34'), 'both `mcpServers` and `arms` are clean');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('🔴 removing the connection does NOT touch the KEY — the expensive part is fetching the key, not the config', () => {
  const dir = tmpCompany();
  try {
    const keyFile = path.join(dir, '.state', 'secrets.json');
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, JSON.stringify({ NOTION_OAUTH_52BA79B8: 'ntn_gia-de-test' }), 'utf8');
    const before = fs.readFileSync(keyFile, 'utf8');

    const company = Company.open(dir);
    assert.deepEqual(
      company.listArms()[0]?.secrets,
      ['NOTION_OAUTH_52BA79B8'],
      'precondition: the arm declares that exact key name',
    );

    company.forgetArm('a354ff2bb34');

    assert.equal(fs.readFileSync(keyFile, 'utf8'), before, 'the key store must be byte-for-byte unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
