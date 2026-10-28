import type { UserDoc, SessionDoc } from '../models/user';
import type { AppAudience, PlatformSettings } from '@campuscare/shared';

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
      authSession?: SessionDoc;
      settings?: PlatformSettings;
      /** True for the CampusCare Android app (custom header + no cookies): sessions use bearer tokens. */
      isMobileClient?: boolean;
      /** Which Android app sent the request (X-CampusCare-App), when it says. */
      clientApp?: AppAudience;
      /** Set when a valid session was refused because it belongs to the other app; names the account's app. */
      wrongApp?: AppAudience;
      /** True when this request was authenticated with an Authorization: Bearer token. */
      bearerAuth?: boolean;
      /** Request id echoed as X-Request-Id and stored on audit entries. */
      correlationId?: string;
    }
  }
}

export {};
