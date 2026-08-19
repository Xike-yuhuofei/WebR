/**
 * Browser Policy + Realtime Debug Workflow static conformance tests.
 *
 * Doc-level checks that pin the project-wide browser rule
 * (docs/architecture/07-BROWSER-POLICY.md) to the exact parameters inherited
 * from the existing SKILL.md, and that the on-demand realtime debug workflow
 * (docs/agents/realtime-debug-workflow.md) follows its required sequence.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url).pathname;

async function readDoc(rel: string): Promise<string> {
  return readFile(`${ROOT}${rel}`, 'utf8');
}

describe('07 — Browser Policy conformance', () => {
  it('inherits the exact SKILL.md browser parameters', async () => {
    const policy = await readDoc('docs/architecture/07-BROWSER-POLICY.md');
    expect(policy).toContain('$HOME/chrome-debug-profile');
    expect(policy).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(policy).toContain('9222');
    expect(policy).toContain('http://[::1]:9222/json/version');
    expect(policy).toContain("chromium.connectOverCDP('http://[::1]:9222')");
    expect(policy).toContain('lsof -nP -iTCP:9222');
    expect(policy).toContain('--user-data-dir="$HOME/chrome-debug-profile"');
  });

  it('forbids default Chrome, temporary profiles, headless browsers and other profiles', async () => {
    const policy = await readDoc('docs/architecture/07-BROWSER-POLICY.md');
    expect(policy).toContain('default Chrome');
    expect(policy).toContain('temporary profiles');
    expect(policy).toContain('headless');
    expect(policy).toContain('any other profile');
  });

  it('reuses login state and forbids re-login / daily-Chrome takeover', async () => {
    const policy = await readDoc('docs/architecture/07-BROWSER-POLICY.md');
    expect(policy).toContain('NEVER re-login');
    expect(policy).toContain('daily Chrome');
  });

  it('declares the default target page', async () => {
    const policy = await readDoc('docs/architecture/07-BROWSER-POLICY.md');
    expect(policy).toContain('https://work.trae.cn/');
  });
});

describe('Realtime Debug Workflow conformance', () => {
  it('references the browser policy and the default target', async () => {
    const wf = await readDoc('docs/agents/realtime-debug-workflow.md');
    expect(wf).toContain('07-BROWSER-POLICY.md');
    expect(wf).toContain('https://work.trae.cn/');
  });

  it('follows the required sequence 真实操作 → 观察状态变化 → 获取证据 → 再诊断/修改', async () => {
    const wf = await readDoc('docs/agents/realtime-debug-workflow.md');
    const step1 = wf.indexOf('真实操作');
    const step2 = wf.indexOf('观察状态变化');
    const step3 = wf.indexOf('获取证据');
    const step4 = wf.indexOf('再诊断/修改');
    expect(step1).toBeGreaterThan(-1);
    expect(step2).toBeGreaterThan(step1);
    expect(step3).toBeGreaterThan(step2);
    expect(step4).toBeGreaterThan(step3);
  });

  it('remains on-demand and does not change the default flow', async () => {
    const wf = await readDoc('docs/agents/realtime-debug-workflow.md');
    expect(wf).toMatch(/on-demand/i);
    expect(wf).toContain('Capture → Audit → Reconstruct → Validate');
  });
});

describe('Project-wide wiring', () => {
  it('AGENTS.md lists the browser policy and the realtime debug workflow', async () => {
    const agents = await readDoc('AGENTS.md');
    expect(agents).toContain('docs/architecture/07-BROWSER-POLICY.md');
    expect(agents).toContain('docs/agents/realtime-debug-workflow.md');
  });

  it('README.md lists the browser policy in the canonical documents', async () => {
    const readme = await readDoc('README.md');
    expect(readme).toContain('07-BROWSER-POLICY.md');
    expect(readme).toContain('realtime-debug-workflow.md');
  });
});
