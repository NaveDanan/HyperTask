import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'rolldown';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LocalAISettingPBSchema, StreamChatPayloadPBSchema, ChatMessagePBSchema, LoadPrevChatMessagePBSchema, ChatMessageListPBSchema, ChatMessageErrorPBSchema } from '@shared/protobuf/flowy-ai/entities_pb';
import { ChatNotification } from '@shared/protobuf/flowy-ai/notification_pb';
import { SubscribeObjectSchema } from '@shared/protobuf/flowy-notification/subject_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { CreateViewPayloadPBSchema, ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { HyperAICredentials, HYPER_AI_KEY_ENV } from '../src/main/HyperAICredentials';
import { CoreProcess } from '../src/main/core/process';
import { Status } from '../src/main/core/protocol';
import { coreBinaryPath } from '../src/main/core/binary';

const root = path.resolve(__dirname, '..');
const binary = coreBinaryPath(root, false);
const electron = path.join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
const native = process.platform !== 'win32' && fs.existsSync(electron) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY));
(native ? describe : describe.skip)('Hyper AI credentials with native OS storage', () => {
  it('roundtrips a disposable key through secure OS storage or explicitly rejects an insecure backend', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-native-credentials-'));
    try {
      const bundled = await build({ input: path.join(root, 'src/main/HyperAICredentials.ts'), platform: 'node', external: [/^node:/], output: { format: 'cjs' }, write: false });
      const chunk = bundled.output.find(item => item.type === 'chunk');
      if (chunk?.type !== 'chunk') throw new Error('No native credential helper');
      fs.writeFileSync(path.join(temporary, 'helper.cjs'), chunk.code);
      const main = path.join(temporary, 'main.cjs');
      fs.writeFileSync(main, `
        const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path');
        const {HyperAICredentials,HYPER_AI_KEY_ENV}=require('./helper.cjs');
        app.whenReady().then(async()=>{
          const support=${JSON.stringify(path.join(temporary, 'support'))};
          const options={supportDirectory:()=>support,platform:process.platform,safeStorage};
          const manager=new HyperAICredentials(options),before=manager.coreEnvironment();
          const backend=process.platform==='linux'?safeStorage.getSelectedStorageBackend():null;
          const supported=safeStorage.isEncryptionAvailable()&&backend!=='basic_text'&&backend!=='unknown';
          if(!supported){let rejected=false;try{await manager.protect('integration-only-dummy-key')}catch{rejected=true}console.log(JSON.stringify({supported,rejected,backend}));app.exit(rejected?0:1);return;}
          try{
            const encrypted=await manager.protect('integration-only-dummy-key');
            const restarted=new HyperAICredentials(options);
            const roundtrip=await restarted.unprotect(encrypted)==='integration-only-dummy-key';
            const sameKey=restarted.coreEnvironment()[HYPER_AI_KEY_ENV]===before[HYPER_AI_KEY_ENV];
            const file=path.join(support,'local_ai/credential-key.bin');
            const noPlaintext=!fs.readFileSync(file).includes(Buffer.from('integration-only-dummy-key'));
            console.log(JSON.stringify({supported,backend,roundtrip,sameKey,noPlaintext}));app.exit(roundtrip&&sameKey&&noPlaintext?0:1);
          }catch{console.error('Native credential roundtrip failed');app.exit(1)}
        }).catch(()=>app.exit(1));
      `);
      const { stdout } = await promisify(execFile)(electron, ['--no-sandbox', `--user-data-dir=${path.join(temporary, 'profile')}`, main], { timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
      console.info('Native secure-storage metadata:', JSON.stringify(result));
      if (result.supported) expect(result).toMatchObject({ roundtrip: true, sameKey: true, noPlaintext: true });
      else expect(result.rejected).toBe(true);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});

(fs.existsSync(binary) ? describe : describe.skip)('Hyper encrypted AI keys (real Rust core)', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-core-credentials-'));
  const wrappingKey = randomBytes(32), dummyKey = 'integration-only-authenticated-key';
  const safeStorage = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (text: string) => { const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce); return Buffer.concat([nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    decryptString: (bytes: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', wrappingKey, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8'); },
  };
  const makeManager = () => new HyperAICredentials({ supportDirectory: () => support, platform: 'linux', safeStorage });
  let credentials = makeManager(), core = new CoreProcess(binary, () => credentials.coreEnvironment());
  const authorizations: string[] = [];
  const models: string[] = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    if (request.headers.authorization !== `Bearer ${dummyKey}`) { response.writeHead(401).end(); return; }
    if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })); return; }
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    const model = JSON.parse(body).model;
    if (!['model-a', 'model-b'].includes(model)) { response.writeHead(400).end(); return; }
    authorizations.push(request.headers.authorization ?? ''); models.push(model);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'authenticated' } }] })}\n\ndata: [DONE]\n\n`);
  });
  const initialize = async () => {
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-encrypted-key-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
  };
  async function request(event: string, schema?: DescMessage, value: object = {}) {
    const bytes = schema ? toBinary(schema, create(schema, value as MessageInitShape<DescMessage>)) : new Uint8Array();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      core.request(event, bytes),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Core credential fixture request timed out: ${event}`)), 15_000); }),
    ]).finally(() => clearTimeout(timer));
    if (reply.status !== Status.Ok) throw new Error(`${event}: ${fromBinary(FlowyErrorSchema, reply.payload).msg}`);
    return reply.payload;
  }
  async function call<O extends DescMessage>(event: string, output: O, input?: [DescMessage, object]) { return fromBinary(output, await request(event, input?.[0], input?.[1])); }
  afterAll(async () => { await core.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(support, { recursive: true, force: true }); });
  it('saves a key after core startup and decrypts it for authenticated requests across restart', async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const parentValue = process.env[HYPER_AI_KEY_ENV];
    await initialize();
    await call('SignUp', UserProfilePBSchema, [SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-encrypted-key-test' }]);
    const protectedKey = await credentials.protect(dummyKey);
    const settings = path.join(support, 'local_ai/endpoint.json');
    fs.writeFileSync(settings, JSON.stringify({ base_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, model: 'model-a', enabled: true, protected_key: protectedKey }), { mode: 0o600 });
    expect(fs.readFileSync(settings, 'utf8')).not.toContain(dummyKey);
    await request('UpdateLocalAISetting', LocalAISettingPBSchema, { serverUrl: `openai+file:${settings}`, globalChatModel: 'model-a', embeddingModelName: '' });
    const workspace = await call('ReadCurrentWorkspace', WorkspacePBSchema);
    let chat = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.id, name: 'Encrypted-key fixture', layout: ViewLayoutPB.Chat, setAsCurrent: false }]);
    const originalChatId = chat.id;
    const send = async (message: string, count: number, answers = count) => {
      await call('StreamMessage', ChatMessagePBSchema, [StreamChatPayloadPBSchema, { chatId: chat.id, message, answerStreamPort: 101n, questionStreamPort: 102n, messageType: 1 }]);
      await vi.waitFor(() => expect(authorizations).toHaveLength(count), { timeout: 10_000 });
      await vi.waitFor(async () => {
        const messages = await call('LoadPrevMessage', ChatMessageListPBSchema, [LoadPrevChatMessagePBSchema, { chatId: chat.id, limit: 50n }]);
        expect(messages.messages.filter(message => message.content === 'authenticated')).toHaveLength(answers);
      }, { timeout: 10_000 });
    };
    await send('first', 1);
    await core.stop(); credentials = makeManager(); core = new CoreProcess(binary, () => credentials.coreEnvironment()); await initialize();
    await send('after restart', 2);
    const configuration = JSON.parse(fs.readFileSync(settings, 'utf8'));
    configuration.model = 'model-b';
    fs.writeFileSync(settings, JSON.stringify(configuration), { mode: 0o600 });
    await request('UpdateLocalAISetting', LocalAISettingPBSchema, { serverUrl: `openai+file:${settings}`, globalChatModel: 'model-b', embeddingModelName: '' });
    await core.stop(); credentials = makeManager(); core = new CoreProcess(binary, () => credentials.coreEnvironment()); await initialize();
    expect((await call('GetLocalAISetting', LocalAISettingPBSchema)).globalChatModel).toBe('model-b');
    chat = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.id, name: 'New chat uses saved default', layout: ViewLayoutPB.Chat, setAsCurrent: false }]);
    await send('new default', 3, 1);
    expect(models).toEqual(['model-a', 'model-a', 'model-b']);
    const parallel = await call('CreateView', ViewPBSchema, [CreateViewPayloadPBSchema, { parentViewId: workspace.id, name: 'Parallel message ids', layout: ViewLayoutPB.Chat, setAsCurrent: false }]);
    await Promise.all([chat.id, parallel.id].map((chatId, index) => call('StreamMessage', ChatMessagePBSchema, [StreamChatPayloadPBSchema, { chatId, message: `parallel ${index}`, answerStreamPort: 110n + BigInt(index * 2), questionStreamPort: 111n + BigInt(index * 2), messageType: 1 }])));
    await vi.waitFor(async () => {
      const lists = await Promise.all([originalChatId, chat.id, parallel.id].map(chatId => call('LoadPrevMessage', ChatMessageListPBSchema, [LoadPrevChatMessagePBSchema, { chatId, limit: 50n }])));
      expect(lists.map(list => list.messages.length)).toEqual([4, 4, 2]);
      const ids = lists.flatMap(list => list.messages.map(message => message.messageId.toString()));
      expect(new Set(ids).size).toBe(10);
    }, { timeout: 10_000 });
    expect(models).toEqual(['model-a', 'model-a', 'model-b', 'model-b', 'model-b']);
    expect(authorizations.every(value => value === `Bearer ${dummyKey}`)).toBe(true);
    expect(process.env[HYPER_AI_KEY_ENV] === parentValue).toBe(true);
    expect(fs.readFileSync(settings, 'utf8')).not.toContain(dummyKey);
    await core.stop(); core = new CoreProcess(binary, () => ({ [HYPER_AI_KEY_ENV]: undefined }));
    const errors: string[] = [];
    core.on('notification', bytes => {
      const subject = fromBinary(SubscribeObjectSchema, bytes);
      if (subject.source === 'Chat' && subject.ty === ChatNotification.StreamChatMessageError && subject.oneOfPayload.case === 'payload') errors.push(fromBinary(ChatMessageErrorPBSchema, subject.oneOfPayload.value).errorMessage);
    });
    await initialize();
    await call('StreamMessage', ChatMessagePBSchema, [StreamChatPayloadPBSchema, { chatId: chat.id, message: 'missing key environment', answerStreamPort: 103n, questionStreamPort: 104n, messageType: 1 }]);
    await vi.waitFor(() => expect(errors.some(error => error.includes('locked'))).toBe(true), { timeout: 10_000 });
    expect(authorizations).toHaveLength(5);
  });
});
