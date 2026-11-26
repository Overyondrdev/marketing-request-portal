import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Test-only: migrations to apply, and a local identity (the Access check is tested separately).
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, 'migrations')),
          DEV_EMAIL: 'sam.requester@overyondr.com',
          OWNER_EMAILS: 'alex.owner@overyondr.com',
        },
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
