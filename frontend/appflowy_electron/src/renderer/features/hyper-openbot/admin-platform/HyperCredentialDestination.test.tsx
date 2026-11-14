import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
vi.stubGlobal('React',React);
vi.mock('../vault',()=>({HyperKeyForm:()=> <div data-credential-form="true"/>}));
import HyperCredentialsSection from './HyperCredentialsSection';
it('consumes Credentials New while retaining Back and withholding the form until the server read succeeds',()=>{
 const fresh=renderToStaticMarkup(<HyperCredentialsSection path="/admin/credentials/new"/>);
 const list=renderToStaticMarkup(<HyperCredentialsSection path="/admin/credentials"/>);
 expect(fresh).toContain('Back to credentials');expect(fresh).not.toContain('data-credential-form');
 expect(list).toContain('Add credential');expect(list).not.toContain('Back to credentials');
});
