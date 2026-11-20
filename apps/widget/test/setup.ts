// Testing Library registers its own afterEach(cleanup) only when Vitest globals
// are on; they are off here, so rendered components would leak across tests.

import { cleanup } from '@testing-library/vue';
import { afterEach } from 'vitest';

afterEach(cleanup);
