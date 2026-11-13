import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { create, fromBinary, toBinary, type DescMessage, type MessageInitShape } from '@bufbuild/protobuf';
import { afterAll, describe, expect, it } from 'vitest';
import { DownloadFilePBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { WorkspacePBSchema } from '@shared/protobuf/flowy-folder/workspace_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { SignUpPayloadPBSchema } from '@shared/protobuf/flowy-user/auth_pb';
import { UserProfilePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { AuthTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { CoreProcess } from '../src/main/core/process';
import { coreBinaryPath } from '../src/main/core/binary';
import { Status } from '../src/main/core/protocol';

// Run after the coordinated core build and protobuf generation. The explicit descriptor
// assertion prevents an older schema from silently dropping the opt-in field.
const binary = coreBinaryPath(path.resolve(__dirname, '..'), false);
(fs.existsSync(binary) ? describe : describe.skip)('Native DownloadFile completion and legacy acknowledgement', () => {
  const support = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-download-completion-core-'));
  const core = new CoreProcess(binary);
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0i8pjYGBgYmBgQFAAFDYBFAyUwTgAAAAASUVORK5CYII=', 'base64'));
  });
  async function request(event: string, schema?: DescMessage, input: object = {}) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      core.request(event, schema ? toBinary(schema, create(schema, input as MessageInitShape<DescMessage>)) : new Uint8Array()),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`Core request timed out: ${event}`)), 15_000); }),
    ]).finally(() => clearTimeout(timer));
  }
  async function call<O extends DescMessage>(event: string, output: O, schema?: DescMessage, input?: object) {
    const result = await request(event, schema, input); if (result.status !== Status.Ok) throw Error(`${event}: ${fromBinary(FlowyErrorSchema, result.payload).msg}`); return fromBinary(output, result.payload);
  }
  afterAll(async () => {
    await core.stop(); server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(support, { recursive: true, force: true });
  });
  it('returns local provider failure for opt-in completion, retains default acknowledgement bytes and never writes or falls back to public HTTP', async () => {
    expect(DownloadFilePBSchema.fields.some(field => field.localName === 'waitForCompletion'), 'Regenerate bindings after building the core before running this fixture').toBe(true);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    await core.start(() => {});
    expect(await core.init({ root: support, app_version: '0.11.4', custom_app_path: support, origin_app_path: support, device_id: 'hyper-download-completion-test', platform: process.platform, authenticator_type: 0, appflowy_cloud_config: { base_url: '', ws_base_url: '', gotrue_url: '' }, envs: {} })).toBe(0);
    await call('SignUp', UserProfilePBSchema, SignUpPayloadPBSchema, { email: 'anon@appflowy.io', name: 'Me', password: 'Guest!@123456', authType: AuthTypePB.Local, deviceId: 'hyper-download-completion-test' });
    const workspace = await call('ReadCurrentWorkspace', WorkspacePBSchema), address = server.address(); if (!address || typeof address === 'string') throw Error('Missing loopback address');
    const url = `http://127.0.0.1:${address.port}/api/file_storage/${workspace.id}/v1/blob/document/picture.png`;
    const legacy = path.join(support, 'legacy.png'), explicitLegacy = path.join(support, 'legacy-false.png');
    fs.writeFileSync(legacy, 'Legacy selected file'); fs.writeFileSync(explicitLegacy, 'Explicit legacy selected file');
    const defaultPayload = { url, localFilePath: legacy }, falsePayload = { ...defaultPayload, waitForCompletion: false };
    expect(toBinary(DownloadFilePBSchema, create(DownloadFilePBSchema, defaultPayload))).toEqual(toBinary(DownloadFilePBSchema, create(DownloadFilePBSchema, falsePayload)));
    const legacyReply = await request('DownloadFile', DownloadFilePBSchema, defaultPayload);
    expect(legacyReply.status, legacyReply.status === Status.Err ? fromBinary(FlowyErrorSchema, legacyReply.payload).msg : 'legacy request transport').toBe(Status.Ok);
    expect((await request('DownloadFile', DownloadFilePBSchema, { url, localFilePath: explicitLegacy, waitForCompletion: false })).status).toBe(Status.Ok);
    const legacyMissing = await request('DownloadFile', DownloadFilePBSchema, { url, localFilePath: path.join(support, 'legacy-missing.png') });
    expect(legacyMissing.status).toBe(Status.Err); expect(fromBinary(FlowyErrorSchema, legacyMissing.payload).msg).toContain('invalid_path');
    const destination = path.join(support, 'completed.png');
    const completed = await request('DownloadFile', DownloadFilePBSchema, { url, localFilePath: destination, waitForCompletion: true });
    expect(completed.status).toBe(Status.Err);
    const failure = fromBinary(FlowyErrorSchema, completed.payload);
    // LocalServer has no cloud storage provider. This exact error comes through the
    // completed manager/storage/provider branch, rather than PB path validation.
    expect(failure.code).toBe(ErrorCode.Internal); expect(failure.msg).toBe('Internal error'); expect(failure.msg).not.toContain('invalid_path');
    expect(fs.existsSync(destination)).toBe(false);
    const existing = path.join(support, 'existing.png'); fs.writeFileSync(existing, 'Previous selected file');
    const retained = await request('DownloadFile', DownloadFilePBSchema, { url, localFilePath: existing, waitForCompletion: true }); expect(retained.status).toBe(Status.Err); expect(fs.readFileSync(existing, 'utf8')).toBe('Previous selected file');
    await new Promise(resolve => setTimeout(resolve, 75));
    expect(fs.readFileSync(legacy, 'utf8')).toBe('Legacy selected file'); expect(fs.readFileSync(explicitLegacy, 'utf8')).toBe('Explicit legacy selected file');
    expect(fs.readdirSync(support).filter(name => name.startsWith('.HyperTask-download-'))).toEqual([]);
    expect(requests).toBe(0);
  }, 40_000);
});
