import { expect, it } from 'vitest';
import { hyperClassifyBrowserReturn as classify } from './HyperBrowserReturn';
it('accepts only the pinned credential-free return', () => { expect(classify('openbot://open')).toBe('return'); });
it.each(['openbot://open?token=secret', 'openbot://open#secret', 'openbot://open/anything', 'openbot://user@open', 'openbot://open:123', 'openbot://%6fpen', 'openbot://open?app=id', 'openbot://open?serverId=id', 'openbot://open' + ' '.repeat(3000), 'appflowy-flutter://connection-callback?token=secret'])('consumes rejected sensitive URI %s', raw => { expect(classify(raw)).toBe('reject'); });
it.each(['appflowy-flutter://login-callback#access_token=synthetic', 'appflowy-flutter://invitation-callback?workspace_id=id&email=a', 'appflowy-flutter:///'])('preserves ordinary AppFlowy links', raw => { expect(classify(raw)).toBe('ordinary'); });
