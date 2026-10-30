import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No incremental cache: the only page is static and every API route renders per request.
export default defineCloudflareConfig();
