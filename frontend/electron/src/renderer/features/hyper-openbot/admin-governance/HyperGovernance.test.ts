// Governance parity contracts adapted from OpenBot. Copyright (c) 2026 CopilotKit. MIT licensed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({
  hyperOpenBotRequest: vi.fn()
}));
import { hyperOpenBotRequest } from '../transport';
import { hyperGovernanceRequest, hyperPeople, hyperSetPersonRole, hyperSetPersonAccess, hyperProviderBody, hyperAuditExportPath } from './HyperGovernanceApi';
import { hyperValidateGovernanceResponse } from './HyperGovernanceContracts';
import { RULE_TEMPLATES, withRuleReplaced, withoutRule, ruleLabel } from './HyperBoundaryRules';
import { EMPTY_WHAT_IF_ACTION, missingFrom, whatIfExplainable, hostIn, type WhatIfVocabulary } from './HyperWhatIfModel';
import { auditFilterParams, auditFiltersFromParams } from './HyperAuditFilters';
import { outcomeOf } from './HyperAuditOutcome';
import { oneRowPerAction } from './HyperActivityRows';
const transport = vi.mocked(hyperOpenBotRequest);
beforeEach(() => {
  transport.mockReset();
});
describe('admin-governance transport contracts', () => {
  it('passes server search and cursors without truncating or interpreting them', async () => {
    transport.mockResolvedValue({
      people: [],
      nextCursor: null
    });
    await hyperPeople('a&b@example.test', 'older?cursor');
    expect(transport).toHaveBeenCalledWith('/api/admin/people?search=a%26b%40example.test&cursor=older%3Fcursor');
  });
  it('posts role and access changes to encoded person paths', async () => {
    await hyperSetPersonRole('person#1', 'admin');
    await hyperSetPersonAccess('person#1', true);
    expect(transport).toHaveBeenNthCalledWith(1, '/api/admin/people/person%231/role', 'POST', {
      role: 'admin'
    });
    expect(transport).toHaveBeenNthCalledWith(2, '/api/admin/people/person%231/access', 'POST', {
      revoked: true
    });
  });
  it('preserves authoritative partial computer termination results', async () => {
    const result = {
      stopped: ['bot1'],
      failed: [{
        botId: 'bot2',
        reason: 'Busy'
      }]
    };
    transport.mockResolvedValue(result);
    expect(await hyperGovernanceRequest('/api/admin/enterprise/people/id/terminate-computers', 'POST')).toBe(result);
  });
  it('keeps OIDC secrets in the registration body and derives discovery from issuer', () => {
    expect(hyperProviderBody({
      protocol: 'oidc',
      providerId: 'test',
      domain: 'example.test',
      issuer: 'https://id.example.test/',
      clientId: 'client',
      clientSecret: 'synthetic-secret'
    })).toEqual({
      providerId: 'test',
      domain: 'example.test',
      issuer: 'https://id.example.test/',
      oidcConfig: {
        clientId: 'client',
        clientSecret: 'synthetic-secret',
        discoveryEndpoint: 'https://id.example.test/.well-known/openid-configuration'
      }
    });
  });
  it('sends SAML metadata in the upstream Better Auth envelope', () => {
    expect(hyperProviderBody({
      protocol: 'saml',
      providerId: 'idp',
      domain: 'example.test',
      issuer: 'https://id.example.test',
      entryPoint: 'https://id.example.test/saml',
      metadata: '<metadata/>',
      clientSecret: 'unused'
    })).toEqual({
      providerId: 'idp',
      domain: 'example.test',
      issuer: 'https://id.example.test',
      samlConfig: {
        entryPoint: 'https://id.example.test/saml',
        idpMetadata: {
          metadata: '<metadata/>'
        }
      }
    });
  });
  it.each(['/api/admin/enterprise/capabilities/translate', '/api/approvals/team/rules/translate', '/api/approvals/team/guidance/check', '/api/computers/policy-translate', '/api/admin/what-if/ask'])('rejects malformed successful model responses at %s', async path => {
    transport.mockResolvedValue({
      check: {
        ok: true
      },
      secret: 'never show payloads in validation errors'
    });
    await expect(hyperGovernanceRequest(path, 'POST', {
      text: 'A description'
    })).rejects.toThrow('invalid governance response');
  });
  it('does not turn server refusal into success or expose it as saved data', async () => {
    transport.mockRejectedValue(new Error('OpenBot request failed (403)'));
    const failure = await hyperGovernanceRequest('/api/approvals/team', 'PATCH', {
      customRulesEnabled: false
    }).then(() => null, error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('403');
  });
  it('keeps failed validation, explanation, and warnings for the screen', async () => {
    const result = {
      changes: [],
      summary: null,
      explanation: null,
      warning: 'Nobody would have access',
      check: {
        ok: false,
        error: 'Unknown permission',
        problems: []
      }
    };
    transport.mockResolvedValue(result);
    expect(await hyperGovernanceRequest('/api/admin/enterprise/capabilities/translate', 'POST', {
      text: 'Unknown permission'
    })).toBe(result);
  });
  it('preserves structurally valid failed-check approval rows for correction, not saving', async () => {
    const result = { rules: [{ botId: '*', toolRef: 'app/read', effect: '*', scope: '*', behaviour: 'deny' }], summary: null, explanation: 'Correct this behavior', warning: null, check: { ok: false, error: 'Unknown behavior', problems: [] } };
    transport.mockResolvedValue(result);
    expect(await hyperGovernanceRequest('/api/approvals/team/rules/translate', 'POST', { text: 'A described rule' })).toBe(result);
  });
  it('still refuses an invalid approval behavior claimed to have passed its check', () => {
    expect(() => hyperValidateGovernanceResponse('/api/approvals/team/rules/translate', 'POST', { rules: [{ botId: '*', toolRef: 'app/read', effect: '*', scope: '*', behaviour: 'deny' }], summary: null, explanation: null, warning: null, check: { ok: true } })).toThrow();
  });
  it.each([['/api/admin/enterprise/capabilities/batch', {
    changes: [{
      scopeKind: 'role',
      scopeId: 'user',
      capability: 'useBots',
      allowed: false
    }],
    authoring: {
      source: 'english',
      text: 'A description'
    }
  }], ['/api/approvals/team/rules/batch', {
    rules: [{
      botId: '*',
      toolRef: 'computer_click',
      effect: '*',
      scope: '*',
      behaviour: 'ask'
    }],
    authoring: {
      source: 'english',
      text: 'A description'
    }
  }]])('sends batch authoring with %s', async (path, body) => {
    transport.mockResolvedValue({
      saved: []
    });
    await hyperGovernanceRequest(path as string, 'POST', body);
    expect(transport).toHaveBeenCalledWith(path, 'POST', body);
  });
  it('requires backtest reports and complete guidance replay counts', () => {
    expect(() => hyperValidateGovernanceResponse('/api/approvals/team/rules/backtest', 'POST', {
      check: {
        ok: true
      }
    })).toThrow();
    expect(() => hyperValidateGovernanceResponse('/api/approvals/team/guidance/backtest', 'GET', {
      calls: 2,
      skippedSafety: 1
    })).not.toThrow();
    expect(() => hyperValidateGovernanceResponse('/api/approvals/team/guidance/backtest', 'POST', {
      calls: 2
    })).toThrow();
  });
});
describe('boundary rule editing', () => {
  const rule = RULE_TEMPLATES[0];
  const policy = {
    mode: 'enforce' as const,
    deny: [rule.rule, 'false'],
    allow: ['true']
  };
  it('preserves rule position, mode, allowlist and template label after an edit', () => {
    const edited = withRuleReplaced(policy, rule.rule, 'intent == "type"');
    expect(edited.deny).toEqual(['intent == "type"', 'false']);
    expect(edited.allow).toEqual(['true']);
    expect(edited.mode).toBe('enforce');
    expect(edited.labels?.['intent == "type"']).toEqual({
      name: rule.name,
      description: rule.description
    });
  });
  it('removes labels with the rule and preserves the remaining policy', () => {
    expect(withoutRule({
      ...policy,
      labels: {
        false: {
          name: 'Other',
          description: ''
        }
      }
    }, 'false')).toEqual({
      ...policy,
      deny: [rule.rule],
      labels: {}
    });
  });
  it('recognizes legacy template expressions', () => {
    const legacy = RULE_TEMPLATES.find(t => t.formerRules?.length)!;
    expect(ruleLabel(policy, legacy.formerRules![0]).name).toBe(legacy.name);
  });
});
describe('what-if guards and audit filtering', () => {
  const vocabulary: WhatIfVocabulary = {
    bots: [{
      id: 'bot',
      name: 'Bot',
      owner: 'person'
    }],
    people: [{
      id: 'person',
      name: null,
      email: 'a@example.test'
    }],
    groups: ['Team'],
    apps: [{
      id: 'gmail',
      name: 'Gmail',
      tools: [{
        name: 'read',
        effect: 'read',
        destructive: false
      }]
    }]
  };
  const action = {
    ...EMPTY_WHAT_IF_ACTION,
    bot: 'bot',
    person: 'person',
    app: 'gmail',
    tool: 'read'
  };
  it('requires real server choices, mutually exclusive actors and app tools', () => {
    expect(missingFrom(action, vocabulary)).toBeNull();
    expect(missingFrom({
      ...action,
      bot: 'gone'
    }, vocabulary)).toMatch('Bot');
    expect(missingFrom({
      ...action,
      group: 'Team'
    }, vocabulary)).toMatch('not both');
    expect(missingFrom({
      ...action,
      tool: 'write'
    }, vocabulary)).toMatch('tools');
  });
  it('validates browser hosts and limits optional command details', () => {
    expect(missingFrom({
      ...action,
      surface: 'computer',
      intent: 'navigate'
    }, vocabulary)).toMatch('web site');
    expect(missingFrom({
      ...action,
      surface: 'computer',
      intent: 'run_command',
      command: 'x'.repeat(301)
    }, vocabulary)).toMatch('300');
    expect(hostIn('https://Example.test/page')).toBe('example.test');
  });
  it('only explains Bot computer and app actions', () => {
    expect(whatIfExplainable({
      eventType: 'computer.action_refused',
      payload: {
        bot: 'bot',
        action: 'computer_click'
      }
    })).toBe(true);
    expect(whatIfExplainable({
      eventType: 'computer.action_refused',
      payload: {
        bot: 'bot',
        action: 'host/read_file'
      }
    })).toBe(false);
    expect(whatIfExplainable({
      eventType: 'configuration.changed'
    })).toBe(false);
  });
  it('round trips lists and boundary expressions containing commas', () => {
    const filters = {
      bot: 'bot',
      app: ['gmail', 'calendar'],
      rule: 'contains(element.name, "submit")',
      from: '2026-01-01T00:00:00Z'
    };
    expect(auditFiltersFromParams(new URLSearchParams(auditFilterParams(filters)))).toEqual(filters);
  });
  it('exports the same filters without cursor or page limit', () => {
    const url = new URL(hyperAuditExportPath('?app=gmail&cursor=old&limit=50&format=json'), 'https://example.test');
    expect([...url.searchParams]).toEqual([['app', 'gmail'], ['format', 'csv']]);
  });
  it('distinguishes refusals, failures, and approval denials', () => {
    expect(outcomeOf('mcp.call_rejected')).toBe('refused');
    expect(outcomeOf('mcp.call_failed')).toBe('did-not-happen');
    expect(outcomeOf({
      eventType: 'approval.person_decided',
      payload: {
        decision: 'deny'
      }
    })).toBe('refused');
    expect(outcomeOf('mcp.call_succeeded')).toBe('allowed');
  });
  it('leaves unrelated audit events intact when deduplicating actions', () => {
    const events = [{
      id: '1',
      eventType: 'credential.created',
      payload: {}
    }, {
      id: '2',
      eventType: 'capability.changed',
      payload: {}
    }];
    expect(oneRowPerAction(events)).toEqual(events);
  });
});
