import type { UserDoc, SessionDoc } from '../models/user';
import type { PlatformSettings } from '@campuscare/shared';

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
      authSession?: SessionDoc;
      settings?: PlatformSettings;
      /** True for the CampusCare Android app (custom header + no cookies): sessions use bearer tokens. */
      isMobileClient?: boolean;
      /** True when this request was authenticated with an Authorization: Bearer token. */
      bearerAuth?: boolean;
      /** Request id echoed as X-Request-Id and stored on audit entries. */
      correlationId?: string;
    }
  }
}

export {};
