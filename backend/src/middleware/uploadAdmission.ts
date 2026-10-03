import { perUserRateLimit } from './rateLimit';

// Every writer to the shared upload store consumes the same account budget.
export const uploadRateLimit = perUserRateLimit({ burst: 3, ratePerMin: 6 });
