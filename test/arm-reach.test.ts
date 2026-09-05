
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

/**
 * A DEAD CREDENTIAL HAS TO REACH THE ARM, not only the account list.
 *
 * Real case 09/03–09/04: the store had a `dead` mark on the account for a full
 * day while the connection screen went on saying *"nothing to fill in again"*
 * and inviting the user to press Try it — which answered with the SDK's raw
 * English 401. Knowing something and saying it where the person is standing
 * are two different things. → `company.ts §arms`
 */
function writeOAuth(dir: string, account: Record<string, unknown>): void {
  const keyFile = path.join(dir, '.state', 'secrets.json');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, JSON.stringify({ $oauth: { NOTION_OAUTH_52BA79B8: account } }), 'utf8');
}

const LIVE = {
  client_id: 'c1',
  access_token: 'at-1',
  refresh_token: 'rt-1',
  token_type: 'Bearer',
  mcp_url: 'https://mcp.notion.com/mcp',
  issuer: 'https://mcp.notion.com',
  label: "Alex's workspace",
};

test('🔴 a REFUSED credential surfaces on the ARM, named by its account label', () => {
  const dir = tmpCompany();
  try {
    writeOAuth(dir, {
      ...LIVE,
      dead: { at: '2026-09-03T04:06:40.864Z', why: 'the key is no longer valid (invalid_grant)' },
    });

    const arm = Company.open(dir).listArms()[0];
    assert.equal(
      arm?.keyDead,
      "Alex's workspace",
      'the LABEL, not the credential name — nobody can redo a sign-in they cannot identify',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a healthy credential leaves `keyDead` ABSENT — the field is a claim, not a default', () => {
  const dir = tmpCompany();
  try {
    writeOAuth(dir, LIVE);
    const arm = Company.open(dir).listArms()[0];
    assert.equal(arm?.keyDead, undefined);
    assert.equal(arm?.via, "Alex's workspace", 'the healthy path is untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a dead credential with NO label falls back to the credential NAME, never to blank', () => {
  const dir = tmpCompany();
  try {
    const { label: _drop, ...unlabelled } = LIVE;
    writeOAuth(dir, { ...unlabelled, dead: { at: '2026-09-03T04:06:40.864Z', why: 'refused' } });

    const arm = Company.open(dir).listArms()[0];
    // Blank would render as *"the service refused the credential for “”"* — an
    // error message that has forgotten what it is about.
    assert.equal(arm?.keyDead, 'NOTION_OAUTH_52BA79B8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
