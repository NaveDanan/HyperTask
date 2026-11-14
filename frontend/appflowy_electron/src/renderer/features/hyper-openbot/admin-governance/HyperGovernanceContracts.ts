// Contracts adapted from OpenBot server/src/admin, approvals, computer and shared/what-if.
// Copyright (c) 2026 CopilotKit. MIT licensed.
import { z } from 'zod';
const object = z.record(z.string(), z.unknown());
const check = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  problems: z.array(object).optional()
});
const nullableText = z.string().nullable();
const reading = z.object({
  summary: nullableText,
  explanation: nullableText,
  warning: nullableText,
  check
});
const person = z.object({
  id: z.string(),
  email: z.string(),
  name: nullableText,
  role: z.enum(['admin', 'user']),
  providers: z.array(z.string()),
  revoked: z.boolean(),
  configuredAdmin: z.boolean(),
  lastSignedInAt: nullableText
});
const policy = z.object({
  mode: z.enum(['dry-run', 'enforce']),
  deny: z.array(z.string()),
  allow: z.array(z.string()),
  labels: z.record(z.string(), z.object({
    name: z.string(),
    description: z.string()
  })).optional()
});
const capability = z.object({
  capability: z.string(),
  title: z.string(),
  description: z.string(),
  default: z.boolean(),
  organization: z.boolean().nullable(),
  roles: z.record(z.string(), z.boolean()),
  groups: z.record(z.string(), z.boolean())
});
const action = z.object({
  bot: z.string(),
  person: z.string(),
  group: z.string(),
  initiator: z.enum(['person', 'routine', 'handoff', 'responsibility', 'memory']),
  surface: z.enum(['app', 'computer']),
  app: z.string(),
  tool: z.string(),
  intent: z.string(),
  host: z.string(),
  label: z.string(),
  command: z.string(),
  file: z.string()
});
const verdict = z.object({
  headline: z.string(),
  outcome: z.string(),
  layers: z.array(z.object({
    id: z.string(),
    title: z.string(),
    verdict: z.string(),
    summary: z.string(),
    decides: z.boolean(),
    unreached: z.boolean()
  }).passthrough()),
  notApplicable: z.array(z.string()),
  notChecked: z.array(z.string())
}).passthrough();
const audience = z.object({ audience: z.enum(['owner', 'people', 'team']), outsideInput: z.boolean(), members: z.array(z.object({ kind: z.enum(['user', 'group']), value: z.string() })) });
const rule = z.object({
  botId: z.string(),
  toolRef: z.string(),
  effect: z.string(),
  scope: z.string(),
  behaviour: z.enum(['allow', 'pre_approved', 'ask', 'hand_off'])
});
export function hyperValidateGovernanceResponse(path: string, method: string, value: unknown): void {
  const route = path.split('?')[0];
  let schema: z.ZodType | undefined;
  if (route.endsWith('/capabilities/translate')) schema = reading.extend({
    changes: z.array(object)
  });else if (route.endsWith('/capabilities/preview')) schema = z.object({
    check,
    people: z.array(z.object({ id: z.string(), name: nullableText, email: z.string(), role: z.string(), groups: z.array(z.string()), capabilities: z.array(z.object({ capability: z.string(), title: z.string(), before: z.object({ allowed: z.boolean(), decidedBy: z.string(), scopeId: z.string() }), after: z.object({ allowed: z.boolean(), decidedBy: z.string(), scopeId: z.string() }), activity: object.optional() })) })),
    counts: z.object({ people: z.number(), losing: z.number(), gaining: z.number(), keeping: z.number(), unchanged: z.number() }),
    activity: z.object({ days: z.number(), unmapped: z.array(object) }),
    warning: nullableText
  });else if (route.endsWith('/rules/translate')) schema = reading.extend({
    rules: z.array(rule)
  });else if (route.endsWith('/rules/backtest')) schema = z.object({
    check,
    warning: nullableText,
    report: z.object({ scanned: z.number(), matched: z.number(), changed: z.number(), removedAsks: z.number(), removedDenied: z.number(), addedAsks: z.number(), fixed: z.number(), changes: z.array(z.object({ id: z.string(), would: z.string(), reason: z.string() }).passthrough()) })
  });else if (route === '/api/computers/policy-translate') schema = z.object({
    rule: z.string(),
    effect: z.enum(['deny', 'allow']),
    compile: check,
    summary: nullableText,
    explanation: nullableText,
    warning: nullableText
  });else if (route === '/api/computers/policy-dry-run') schema = z.object({
    report: z.object({
      scanned: z.number(),
      wouldRefuse: z.number(),
      wouldAllow: z.number(),
      unchanged: z.number(),
      changes: z.array(object)
    })
  });else if (route === '/api/computers/policy') schema = z.object({
    policy
  });else if (route === '/api/admin/people' && method === 'GET') schema = z.object({
    people: z.array(person),
    nextCursor: nullableText
  });else if (route === '/api/me') schema = z.object({
    user: z.object({
      id: z.string(),
      role: z.enum(['admin', 'user'])
    })
  });else if (route === '/api/admin/enterprise' && method === 'GET') schema = z.object({
    capabilities: z.array(capability),
    groups: z.array(z.string()),
    settings: object,
    scim: z.object({
      configured: z.boolean(),
      baseUrl: nullableText
    }),
    otel: z.object({
      configured: z.boolean()
    }),
    actionRecordRetentionDays: z.number()
  });else if (route === '/api/admin/identity-providers' && method === 'GET') schema = z.object({
    providers: z.array(z.object({
      providerId: z.string(),
      issuer: z.string(),
      domain: z.string(),
      protocol: z.enum(['saml', 'oidc']),
      registeredBy: nullableText
    }))
  });else if (route.endsWith('/terminate-computers')) schema = z.object({ stopped: z.array(z.string()), failed: z.array(z.object({ botId: z.string(), reason: z.string() })) });
  else if (route === '/api/admin/enterprise/actions') schema = z.object({ actions: z.array(z.object({ id: z.string(), command: z.string(), surface: z.string(), botId: nullableText, outcome: z.string(), createdAt: z.string() })) });
  else if (route === '/api/approvals' && method === 'GET') schema = z.object({
    enabled: z.boolean(),
    teamRules: z.array(rule.extend({
      id: z.string()
    })),
    team: z.object({
      enforceAutoReview: z.boolean(),
      customRulesEnabled: z.boolean(),
      hostCommandsCap: z.enum(['ask', 'allow', 'never']),
      actionKinds: z.record(z.string(), z.enum(['open', 'ask', 'hand_off'])).optional()
    }).optional()
  });else if (route === '/api/approvals/shared-use' && method === 'GET') schema = z.object({
    requests: z.array(z.object({
      id: z.string(),
      botName: z.string(),
      title: z.string(),
      reason: z.string(),
      current: audience.nullable(),
      proposed: audience
    }))
  });else if (route === '/api/approvals/team/guidance' && method === 'GET') schema = z.object({
    guidance: nullableText
  });else if (route === '/api/approvals/team/guidance/check') schema = z.object({
    check,
    summary: nullableText,
    explanation: z.string()
  });else if (route === '/api/approvals/team/guidance/backtest') schema = method === 'GET' ? z.object({
    calls: z.number(),
    skippedSafety: z.number()
  }) : z.object({
    sample: z.number(),
    reviewed: z.number(),
    agreed: z.number(),
    letThroughDenied: z.number(),
    askedAllowed: z.number(),
    unreviewed: z.number(),
    withoutRequest: z.number(),
    skippedSafety: z.number(),
    rows: z.array(object)
  });else if (route === '/api/admin/what-if/vocabulary') schema = z.object({
    bots: z.array(z.object({
      id: z.string(),
      name: z.string(),
      owner: nullableText
    })),
    people: z.array(z.object({
      id: z.string(),
      name: nullableText,
      email: z.string()
    })),
    groups: z.array(z.string()),
    apps: z.array(z.object({
      id: z.string(),
      name: z.string(),
      tools: z.array(z.object({
        name: z.string(),
        effect: z.enum(['read', 'write']),
        destructive: z.boolean()
      }))
    }))
  });else if (route === '/api/admin/what-if/ask') schema = z.discriminatedUnion('understood', [z.object({
    understood: z.literal('yes'),
    action,
    missing: nullableText,
    labels: object
  }), z.object({
    understood: z.literal('no'),
    unclear: z.string()
  })]);else if (route === '/api/admin/what-if/check') schema = z.object({
    action,
    result: verdict
  });else if (route.startsWith('/api/admin/what-if/explain/')) schema = z.object({
    action,
    result: verdict,
    recorded: z.object({
      summary: z.string()
    })
  });else if (route === '/api/admin/audit-events' && method === 'GET') schema = z.object({
    events: z.array(z.object({
      id: z.string(),
      eventType: z.string(),
      createdAt: z.string(),
      actorUserId: nullableText,
      targetType: z.string(),
      targetId: nullableText,
      payload: object
    })),
    nextCursor: z.string().optional()
  });else if (route === '/api/admin/audit-events/ask') schema = z.object({
    answerable: z.enum(['yes', 'partly', 'no']),
    filters: object,
    reading: nullableText,
    unanswered: nullableText,
    labels: object
  });
  if (schema && !schema.safeParse(value).success) throw new Error('The server returned an invalid governance response.');
}
