export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Barakah API',
    version: '1.0.0',
    description:
      'Barakah Quran Khawani & Collective Ibadah Platform — core MVP REST API. Custom JWT auth (not Supabase Auth). Consistent envelope: `{ success, data }` / `{ success:false, error }`.',
  },
  servers: [{ url: '/api/v1', description: 'API v1' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      SuccessEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
          meta: { type: 'object' },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
            },
          },
          requestId: { type: 'string' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        security: [],
        summary: 'Login',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  rememberMe: { type: 'boolean' },
                  orgId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Access token + user; refresh cookie set' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        security: [],
        summary: 'Rotate refresh token',
        tags: ['Auth'],
        responses: { '200': { description: 'New access token' } },
      },
    },
    '/auth/logout': {
      post: {
        security: [],
        summary: 'Logout and revoke refresh family',
        tags: ['Auth'],
        responses: { '200': { description: 'Logged out' } },
      },
    },
    '/auth/change-password': {
      post: {
        summary: 'Change password (clears must_change_password)',
        tags: ['Auth'],
        responses: { '200': { description: 'Password updated' } },
      },
    },
    '/auth/me': {
      get: {
        summary: 'Current user',
        tags: ['Auth'],
        responses: { '200': { description: 'User profile' } },
      },
    },
    '/users': {
      get: { summary: 'List users (admin)', tags: ['Users'], responses: { '200': { description: 'Paged users' } } },
      post: {
        summary: 'Create user with temporary password (admin-only)',
        tags: ['Users'],
        responses: { '201': { description: 'Created user + temporaryPassword' } },
      },
    },
    '/organizations': {
      get: { summary: 'List my organizations', tags: ['Organizations'], responses: { '200': { description: 'Orgs' } } },
      post: { summary: 'Create organization', tags: ['Organizations'], responses: { '201': { description: 'Created' } } },
    },
    '/organizations/{orgId}/members': {
      post: { summary: 'Add membership', tags: ['Organizations'], responses: { '201': { description: 'Membership' } } },
    },
    '/campaigns': {
      get: { summary: 'List campaigns', tags: ['Campaigns'], responses: { '200': { description: 'Paged' } } },
      post: { summary: 'Create campaign', tags: ['Campaigns'], responses: { '201': { description: 'Created' } } },
    },
    '/campaigns/{campaignId}': {
      get: { summary: 'Get campaign', tags: ['Campaigns'], responses: { '200': { description: 'Detail' } } },
      patch: { summary: 'Update campaign', tags: ['Campaigns'], responses: { '200': { description: 'Updated' } } },
      delete: { summary: 'Soft-delete campaign', tags: ['Campaigns'], responses: { '200': { description: 'Deleted' } } },
    },
    '/campaigns/{campaignId}/lifecycle': {
      post: {
        summary: 'Transition campaign status',
        tags: ['Campaigns'],
        responses: { '200': { description: 'Updated status' } },
      },
    },
    '/campaigns/{campaignId}/assignments/distribute': {
      post: {
        summary: 'Deterministic Juz distribution (persist or suggest)',
        tags: ['Assignments'],
        responses: { '200': { description: 'Plan + assignments' } },
      },
    },
    '/campaigns/{campaignId}/assignments/manual': {
      post: {
        summary: 'Manual Juz assignments (exact coverage, no overlaps)',
        tags: ['Assignments'],
        responses: { '200': { description: 'Assignments' } },
      },
    },
    '/campaigns/assignments/{assignmentId}/start': {
      post: { summary: 'Start assignment', tags: ['Assignments'], responses: { '200': { description: 'Started' } } },
    },
    '/campaigns/assignments/{assignmentId}/complete': {
      post: {
        summary: 'Complete assignment (may auto-complete campaign)',
        tags: ['Assignments'],
        responses: { '200': { description: 'Completed' } },
      },
    },
    '/campaigns/assignments/{assignmentId}/skip': {
      post: { summary: 'Admin skip assignment', tags: ['Assignments'], responses: { '200': { description: 'Skipped' } } },
    },
    '/campaigns/{campaignId}/progress': {
      get: { summary: 'Progress dashboard', tags: ['Campaigns'], responses: { '200': { description: 'Stats' } } },
    },
    '/campaigns/{campaignId}/dhikr': {
      get: { summary: 'Dhikr campaign data + leaderboard', tags: ['Dhikr'], responses: { '200': { description: 'Dhikr' } } },
    },
    '/campaigns/{campaignId}/dhikr/batch': {
      post: {
        summary: 'Idempotent Dhikr count batch',
        tags: ['Dhikr'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['clientBatchId', 'delta'],
                properties: {
                  clientBatchId: { type: 'string' },
                  delta: { type: 'integer', minimum: 1, maximum: 1000 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Authoritative totals' } },
      },
    },
    '/health': {
      get: {
        security: [],
        summary: 'Liveness',
        tags: ['System'],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/ready': {
      get: {
        security: [],
        summary: 'Readiness (DB)',
        tags: ['System'],
        responses: { '200': { description: 'Ready' }, '503': { description: 'Not ready' } },
      },
    },
  },
} as const;
