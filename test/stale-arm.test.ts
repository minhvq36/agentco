

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { reachDiff, routeText, staleMentions } from '../dist/core/assistant.js';

const ARMS = {
  aMusic: { label: 'Musics' },
  aInstall: { label: 'Programs Installation' },
  aGrub: { label: 'grub2win' },
  aTiny: { label: 'HS' },
};
const SERVERS = {
  aMusic: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\Downloads\\Musics'] },
  aInstall: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\Downloads\\Programs Installation'] },
  aGrub: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\Downloads\\Programs Installation\\grub2win'] },
  aTiny: { command: 'npx', args: ['-y', 'server-filesystem', 'D:\\HS'] },
};

const check = (live: string[], say: string, userText = '') =>
  staleMentions({ arms: ARMS, servers: SERVERS, live: new Set(live), say, userText });


test('catches the original case: mentions both label + path of an arm that was unplugged', () => {
  const say = 'Bạn muốn soi thư mục nào: Programs Installation (D:\\Downloads\\Programs Installation) hay Musics?'; // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
  assert.deepEqual(check(['aMusic'], say).sort(), ['D:\\Downloads\\Programs Installation', 'Programs Installation']);
});

test('catches when only the path is mentioned — and ALSO catches the label nested inside it', () => {
  assert.deepEqual(check(['aMusic'], 'Mình sẽ xem trong D:\\Downloads\\Programs Installation nhé.').sort(), [ // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
    'D:\\Downloads\\Programs Installation',
    'Programs Installation',
  ]);
});

test('case-insensitive — the model rewrites the name in its own style', () => {
  assert.deepEqual(check(['aMusic'], 'Thư mục PROGRAMS INSTALLATION có gì?'), ['Programs Installation']); // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
});


test('SILENT when the arm is STILL connected — this is a correct sentence, not a stale one', () => {
  assert.deepEqual(check(['aMusic', 'aInstall'], 'Soi Programs Installation hay Musics?'), []); // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
});

test('SILENT when the USER THEMSELVES said that name — the Assistant replying "no one can reach it" is correct', () => {
  const say = 'Hiện không nhân viên nào với tới Programs Installation cả.'; // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
  assert.deepEqual(check(['aMusic'], say, 'Xem giúp mình thư mục Programs Installation'), []); // i18n-allow-vietnamese: user text fed into staleMentions as data under test
});

test('SILENT when a CHILD directory is still connected: mentioning the parent while the child remains is not a lie', () => {
  assert.deepEqual(check(['aGrub'], 'Mình xem trong D:\\Downloads\\Programs Installation nhé.'), []); // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
});

test('SILENT for labels under 4 characters — better to miss than fire on every chat turn', () => {
  assert.deepEqual(check(['aMusic'], 'Mình HS chưa rõ ý bạn lắm.'), []); // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
});


test('routeText: pulls the correct text field for each intent', () => {
  assert.equal(routeText({ intent: 'chat', say: 'Chào bạn' }), 'Chào bạn'); // i18n-allow-vietnamese: sample assistant text fed into routeText as data under test
  assert.equal(routeText({ intent: 'ask', say: 'Thư mục nào?' }), 'Thư mục nào?'); // i18n-allow-vietnamese: sample assistant text fed into routeText as data under test
  assert.equal(routeText({ intent: 'task', request: 'Soi thư mục X', scope: 'new' }), 'Soi thư mục X'); // i18n-allow-vietnamese: sample assistant text fed into routeText as data under test
  assert.equal(routeText({ intent: 'lookup', paths: [], question: 'X là gì' }), 'X là gì'); // i18n-allow-vietnamese: sample assistant text fed into routeText as data under test
});

test('routeText: `garbled` returns EMPTY — that sentence is our own writing, inspecting it is a self-check', () => {
  assert.equal(routeText({ intent: 'garbled', say: 'Mình trả lời sai định dạng…', raw: '{}' }), ''); // i18n-allow-vietnamese: sample assistant text fed into routeText as data under test
});


const map = (o: Record<string, string[]>) => new Map(Object.entries(o));

test('reachDiff: unplugging produces one line of TEXT, not an empty slot', () => {
  assert.deepEqual(
    reachDiff(map({ 'ho-tro': ['Notion (đường tắt tới D:\\N)'] }), map({ 'ho-tro': [] })), // i18n-allow-vietnamese: sample arm-reach label fed into reachDiff as data under test
    ['− Notion ✗ ho-tro'],
  );
});

test('reachDiff: connecting and disconnecting in the same turn', () => {
  assert.deepEqual(
    reachDiff(
      map({ 'ho-tro': ['Notion'], 'nguoi-soi': [] }),
      map({ 'ho-tro': [], 'nguoi-soi': ['Musics (đường tắt tới D:\\Downloads\\Musics)'] }), // i18n-allow-vietnamese: sample arm-reach label fed into reachDiff as data under test
    ),
    ['− Notion ✗ ho-tro', '+ Musics → nguoi-soi'],
  );
});

test('reachDiff: keeps only the LABEL — does not re-inject the path that was just removed', () => {
  const [line] = reachDiff(
    map({ x: ['Programs Installation (đường tắt tới D:\\Downloads\\Programs Installation)'] }), // i18n-allow-vietnamese: sample arm-reach label fed into reachDiff as data under test
    map({ x: [] }),
  );
  assert.equal(line, '− Programs Installation ✗ x');
  assert.ok(!line.includes('D:\\'), 'path must not leak into the diff line');
});

test('reachDiff: no change ⇒ EMPTY — the reminder line stays silent on a normal turn', () => {
  assert.deepEqual(reachDiff(map({ a: ['M'] }), map({ a: ['M'] })), []);
});

test('reachDiff: a retired employee counts as REMOVED, a new one counts as ADDED', () => {
  assert.deepEqual(reachDiff(map({ cu: ['A'] }), map({ moi: ['B'] })), ['− A ✗ cu', '+ B → moi']);
});

test('reachDiff: renaming an arm shows up as remove + add — more honest than staying silent', () => {
  assert.deepEqual(reachDiff(map({ a: ['Musics'] }), map({ a: ['Nhac cua toi'] })), [
    '+ Nhac cua toi → a',
    '− Musics ✗ a',
  ]);
});

test('reachDiff: TURNING ON shell must also produce a line — same bug class as unplugging', () => {
  assert.deepEqual(reachDiff(map({ 'ho-tro': ['Musics'] }), map({ 'ho-tro': ['Musics', 'chạy lệnh'] })), [ // i18n-allow-vietnamese: sample arm-reach label fed into reachDiff as data under test
    '+ chạy lệnh → ho-tro', // i18n-allow-vietnamese: sample arm-reach label fed into reachDiff as data under test
  ]);
});

test('reachDiff: TURNING OFF shell also produces a line, and this direction used to lose to history', () => {
  assert.deepEqual(reachDiff(map({ r: ['chạy lệnh'] }), map({ r: [] })), ['− chạy lệnh ✗ r']); // i18n-allow-vietnamese: sample arm-reach label fed into reachDiff as data under test
});

test('reachDiff: the CAP stops one bulk edit from dumping a wall of text into the session', () => {
  const before = map({ r: ['A', 'B', 'C', 'D', 'E', 'F'] });
  const out = reachDiff(before, map({ r: [] }), 4);
  assert.equal(out.length, 5);
  assert.equal(out[4], 'and 2 more changes');
});


const OAUTH_ARMS = {
  aGhOld: { label: 'GitHub · hubot', via: 'hubot' },
  aGhNew: { label: 'GitHub · octocat', via: 'octocat' },
};
const OAUTH_SRV = { aGhOld: { type: 'http' }, aGhNew: { type: 'http' } };

const stale = (say: string, userText = '', live: string[] = ['aGhNew']) =>
  staleMentions({
    arms: OAUTH_ARMS,
    servers: OAUTH_SRV,
    live: new Set(live),
    say,
    userText,
  });

test('🔴 REAL CASE: account name already removed, mentioned BARE (without "GitHub ·")', () => {
  const hits = stale("Repo 'focus-flow' này nằm trong tài khoản GitHub octocat hay hubot vậy bạn?"); // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
  assert.deepEqual(hits, ['hubot'], 'the `label` needle alone does not catch this case');
});

test('🔴 account STILL connected ⇒ silent — otherwise the gate fires on every turn', () => {
  assert.deepEqual(stale('Mình sẽ đọc repo bằng tài khoản octocat nhé.'), []); // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
});

test('🔴 the USER THEMSELVES brought up that name ⇒ answering about it is CORRECT behavior', () => {
  assert.deepEqual(
    stale('Tài khoản hubot giờ sao rồi?', 'hubot giờ sao rồi?'), // i18n-allow-vietnamese: assistant/user text fed into staleMentions as data under test
    [],
  );
});

test('⭐ missing `via` (arm without OAuth) ⇒ the gate runs exactly as before', () => {
  const hits = staleMentions({
    arms: { aMusic: { label: 'Musics' } },
    servers: { aMusic: {} },
    live: new Set<string>(),
    say: 'Mình đã xem thư mục Musics.', // i18n-allow-vietnamese: assistant reply text fed into staleMentions as data under test
    userText: '',
  });
  assert.deepEqual(hits, ['Musics']);
});
