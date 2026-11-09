import { describe, expect, it, vi } from 'vitest';
import { AFRolePB, WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import { create } from '@bufbuild/protobuf';
import { UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { SettingsPage, visibleSettingsPages, workspaceRole } from './settings-dialog-store';
import { endpointSettingsFromJson, endpointSettingsToJson, endpointErrorMessage, SettingsError } from './ai/openai-endpoint-settings';
import { accessToken, changePasswordErrorFor, passwordRequest, setupPasswordErrorFor, validateChangePassword, validateSetupPassword } from './account/password';
import { colorSchemeFromJsonSoft, colorSchemeToJson, cssToDartColor, dartColorToCss, decodeThemePlugin, dartIntTryParse } from './workspace/flowy-theme';
import {
  combineHexWithOpacity,
  cssToHexString,
  extractHex,
  extractOpacity,
  filterFonts,
  fontFamilyDisplayName,
  hexStringToCss,
  validateHexValue,
  validateOpacityValue,
  workspaceIconColors,
} from './workspace/appearance-utils';
import { FLUTTER_SUPPORTED_LOCALES, languageFromLocale } from './language';

const tr = (key: string, options?: { namedArgs?: Record<string, string> }) => (options?.namedArgs ? `${key}:${JSON.stringify(options.namedArgs)}` : key);

vi.mock('@/backend/events', () => ({}));
vi.mock('@/startup/app-store', () => ({ useAppStore: { getState: () => ({ info: null }) } }));


describe('SettingsMenu visibility', () => {
  it('local mode shows the custom pages and no Members/Sites/Plan', () => {
    expect(visibleSettingsPages({ workspaceType: WorkspaceTypePB.LocalW, role: AFRolePB.Owner, isBillingEnabled: true, debug: false })).toEqual([
      SettingsPage.account,
      SettingsPage.workspace,
      SettingsPage.manageData,
      SettingsPage.notifications,
      SettingsPage.cloud,
      SettingsPage.companyCertificates,
      SettingsPage.shortcuts,
      SettingsPage.ai,
    ]);
  });

  it('server members see Members after Workspace and Sites after AI; debug adds Feature Flags', () => {
    expect(visibleSettingsPages({ workspaceType: WorkspaceTypePB.ServerW, role: AFRolePB.Member, isBillingEnabled: false, debug: true })).toEqual([
      SettingsPage.account,
      SettingsPage.workspace,
      SettingsPage.member,
      SettingsPage.manageData,
      SettingsPage.notifications,
      SettingsPage.cloud,
      SettingsPage.companyCertificates,
      SettingsPage.shortcuts,
      SettingsPage.ai,
      SettingsPage.sites,
      SettingsPage.featureFlags,
    ]);
  });

  it('guests and a missing role hide Members and Sites', () => {
    for (const role of [AFRolePB.Guest, null]) {
      const pages = visibleSettingsPages({ workspaceType: WorkspaceTypePB.ServerW, role, isBillingEnabled: false, debug: false });
      expect(pages).not.toContain(SettingsPage.member);
      expect(pages).not.toContain(SettingsPage.sites);
    }
  });

  it('an unset role one_of reads as Owner, no workspace as null', () => {
    expect(workspaceRole(create(UserWorkspacePBSchema, {}))).toBe(AFRolePB.Owner);
    expect(workspaceRole(create(UserWorkspacePBSchema, { oneOfRole: { case: 'role', value: AFRolePB.Guest } }))).toBe(AFRolePB.Guest);
    expect(workspaceRole(null)).toBeNull();
  });
});

describe('OpenAI endpoint settings file', () => {
  const settings = { baseUrl: 'http://localhost:8000/v1', model: 'm', embeddingModel: '', imageModel: 'img', protectedKey: 'AQAAANCMnd8B', enabled: true };

  it('writes the Dart key order, compact', () => {
    expect(endpointSettingsToJson(settings)).toBe(
      '{"base_url":"http://localhost:8000/v1","model":"m","embedding_model":"","image_model":"img","protected_key":"AQAAANCMnd8B","enabled":true}',
    );
  });

  it('round-trips and defaults the optional keys', () => {
    expect(endpointSettingsFromJson(endpointSettingsToJson(settings))).toEqual(settings);
    expect(endpointSettingsFromJson('{"base_url":"u","model":"m"}')).toEqual({
      baseUrl: 'u',
      model: 'm',
      embeddingModel: '',
      imageModel: '',
      protectedKey: '',
      enabled: false,
    });
  });

  it('requires base_url and model strings', () => {
    expect(() => endpointSettingsFromJson('{"model":"m"}')).toThrow();
    expect(() => endpointSettingsFromJson('{"base_url":"u","model":3}')).toThrow();
    expect(() => endpointSettingsFromJson('[]')).toThrow();
  });

  it('shows Format/State messages, a generic text otherwise', () => {
    expect(endpointErrorMessage(new SettingsError('Endpoint returned no chat completion.', 'format'))).toBe('Endpoint returned no chat completion.');
    expect(endpointErrorMessage(new SettingsError('Could not apply AI endpoint settings: x', 'state'))).toBe('Could not apply AI endpoint settings: x');
    expect(endpointErrorMessage(new SettingsError('timeout', 'other'))).toBe('Could not apply settings. Check the endpoint and try again.');
    expect(endpointErrorMessage(new TypeError('x'))).toBe('Could not apply settings. Check the endpoint and try again.');
  });
});

describe('Password settings', () => {
  it('reads the bearer from the profile token JSON', () => {
    expect(accessToken({ token: '{"access_token":"abc","refresh_token":"r"}' })).toBe('abc');
    expect(accessToken({ token: 'not json' })).toBe('');
  });

  it('checks the change-password fields in order', () => {
    expect(validateChangePassword('', '', '')?.field).toBe('current');
    expect(validateChangePassword('a', '', '')?.key).toContain('newPasswordIsRequired');
    expect(validateChangePassword('a', 'b', '')?.key).toContain('confirmPasswordIsRequired');
    expect(validateChangePassword('a', 'b', 'c')).toEqual({ field: 'confirm', key: 'newSettings.myAccount.password.error.passwordsDoNotMatch' });
    expect(validateChangePassword('a', 'a', 'a')).toEqual({ field: 'new', key: 'newSettings.myAccount.password.error.newPasswordIsSameAsCurrent' });
    expect(validateChangePassword('a', 'b', 'b')).toBeNull();
    expect(validateSetupPassword('', 'x')?.field).toBe('new');
    expect(validateSetupPassword('x', 'y')?.key).toContain('passwordsDoNotMatch');
  });

  it('maps GoTrue errors to fields', () => {
    expect(changePasswordErrorFor({ code: ErrorCode.Internal, msg: 'Incorrect current password' }, tr).field).toBe('current');
    expect(changePasswordErrorFor({ code: ErrorCode.Internal, msg: 'Password should be at least 8 characters' }, tr)).toEqual({
      field: 'new',
      text: 'newSettings.myAccount.password.error.passwordShouldBeAtLeast6Characters:{"min":"8"}',
    });
    expect(changePasswordErrorFor({ code: ErrorCode.NewPasswordTooWeak, msg: 'weak' }, tr).text).toBe('signIn.passwordMustContain');
    expect(changePasswordErrorFor({ code: ErrorCode.Internal, msg: 'boom' }, tr).text).toBe('boom');
    expect(setupPasswordErrorFor({ code: ErrorCode.Internal, msg: 'Incorrect current password' }, tr)).toBe('Incorrect current password');
  });

  it('sends the Dart requests and maps 422 / msg', async () => {
    const calls: Array<{ url: string; method: string; body?: string; headers?: Record<string, string> }> = [];
    const send = async (options: { url: string; method: string; body?: string; headers?: Record<string, string> }) => {
      calls.push(options);
      return options.method === 'GET' ? { status: 200, body: '{"has_password":true}' } : { status: 422, body: '{"msg":"too weak"}' };
    };
    const check = await passwordRequest(send, 'https://af.local', 't', 'checkHasPassword');
    expect(check).toEqual({ ok: true, value: { has_password: true } });
    const change = await passwordRequest(send, 'https://af.local', 't', 'changePassword', { current_password: 'a', password: 'b' });
    expect(change).toEqual({ ok: false, error: { code: ErrorCode.NewPasswordTooWeak, msg: 'too weak' } });
    expect(calls[1]).toMatchObject({
      url: 'https://af.local/gotrue/user/change-password',
      method: 'POST',
      body: '{"current_password":"a","password":"b"}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    });
    const failed = await passwordRequest(async () => ({ status: 500, body: '' }), 'b', 't', 'setupPassword', { password: 'x' });
    expect(failed).toEqual({ ok: false, error: { code: ErrorCode.Internal, msg: 'Failed to setup password' } });
  });
});

describe('Custom theme JSON (FlowyColorScheme)', () => {
  it('parses Dart ints like ColorConverter', () => {
    expect(dartIntTryParse(' 0xff00bcf0 ')).toBe(0xff00bcf0n);
    expect(dartIntTryParse('4278190080')).toBe(4278190080n);
    expect(dartIntTryParse('#fff')).toBeNull();
    expect(dartColorToCss('0xff00bcf0')).toBe('#00BCF0FF');
    expect(dartColorToCss('0x0f1f2329')).toBe('#1F23290F');
    expect(dartColorToCss('nope')).toBe('#00000000');
    expect(cssToDartColor('#00BCF0')).toBe('0xff00bcf0');
    expect(cssToDartColor('#1F23290F')).toBe('0x0f1f2329');
  });

  it('fromJsonSoft overlays the Default scheme and toJson round-trips', () => {
    const light = colorSchemeFromJsonSoft('{"primary":"0xff112233"}', 'light');
    expect(light.primary).toBe('#112233FF');
    expect(light.surface.toUpperCase()).toBe('#FFFFFFFF');
    const json = JSON.parse(colorSchemeToJson(light)) as Record<string, string>;
    expect(json.primary).toBe('0xff112233');
    expect(Object.keys(json)[0]).toBe('surface');
    expect(colorSchemeFromJsonSoft(colorSchemeToJson(light), 'light')).toEqual(light);
  });

  it('reports which file is invalid', () => {
    expect(() => decodeThemePlugin({ name: 'x', light: '{', dark: '{}' })).toThrow('The light theme json file is not valid.');
    expect(() => decodeThemePlugin({ name: 'x', light: '{}', dark: '{"text":1}' })).toThrow('The dark theme json file is not valid.');
    expect(decodeThemePlugin({ name: 'x', light: '{}', dark: '{}' }).name).toBe('x');
  });
});

describe('Workspace page helpers', () => {
  it('converts document colors like toHexString / HexOpacityExtension', () => {
    expect(cssToHexString('#00BCF0')).toBe('0xff00bcf0');
    expect(cssToHexString('#00BCF033')).toBe('0x3300bcf0');
    expect(hexStringToCss('0x3300bcf0')).toBe('#00bcf033');
    expect(extractHex('0xff00bcf0')).toBe('00bcf0');
    expect(extractOpacity('0xff00bcf0')).toBe('100');
    expect(extractOpacity('0x3300bcf0')).toBe('20');
    expect(combineHexWithOpacity('00bcf0', '100')).toBe('0xff00bcf0');
    // A6: no zero padding below 7 %.
    expect(combineHexWithOpacity('00bcf0', '5')).toBe('0xd00bcf0');
  });

  it('validates hex and opacity in the Dart order', () => {
    expect(validateOpacityValue('', tr)).toContain('opacityEmptyError');
    expect(validateOpacityValue('0', tr)).toContain('opacityRangeError');
    expect(validateOpacityValue('101', tr)).toContain('opacityRangeError');
    expect(validateOpacityValue('1.5', tr)).toContain('opacityRangeError');
    expect(validateOpacityValue('50', tr)).toBeNull();
    expect(validateHexValue('', '50', tr)).toContain('hexEmptyError');
    expect(validateHexValue('fff', '50', tr)).toContain('hexLengthError');
    expect(validateHexValue('zzzzzz', '50', tr)).toContain('hexInvalidError');
    expect(validateHexValue('zzzzzz', '', tr)).toBeNull();
    expect(validateHexValue('6fc9e7', '50', tr)).toBeNull();
  });

  it('names and filters fonts like _FontSelectorDropdown', () => {
    expect(fontFamilyDisplayName('', 'System')).toBe('System');
    expect(fontFamilyDisplayName('ABeeZee', 'System')).toBe('ABee Zee');
    expect(fontFamilyDisplayName('NotoSansHK_regular', 'System')).toBe('Noto Sans HK');
    const options = ['', 'Open Sans', 'Roboto', 'Noto Sans'];
    expect(filterFonts(options, '  ', 'Roboto', ['x'], 'System')).toEqual(options);
    expect(filterFonts(options, 'sans', 'Roboto', [], 'System')).toEqual(['Open Sans', 'Noto Sans']);
    expect(filterFonts(options, 'sys', 'Roboto', [], 'System')).toEqual(['']);
    expect(filterFonts(options, 'Roboto', 'Roboto', ['keep'], 'System')).toEqual(['keep']);
  });

  it('picks workspace icon colors from the code-unit sum', () => {
    expect(workspaceIconColors('A')).toEqual(['#2E8B57', '#E0FFF0']); // 65 % 8 = 1
    expect(workspaceIconColors('')).toEqual(['#8A2BE2', '#F0E6FF']);
  });

  it('lists the 33 Flutter locales with native names', () => {
    expect(FLUTTER_SUPPORTED_LOCALES).toHaveLength(33);
    expect(languageFromLocale('en-GB')).toBe('English (GB)');
    expect(languageFromLocale('en-US')).toBe('English (US)');
    expect(languageFromLocale('zh-TW')).toBe('繁體中文');
    expect(languageFromLocale('fr-CA')).toBe('Français (CA)');
    expect(languageFromLocale('vi-VN')).toBe('vi');
    expect(languageFromLocale('hin')).toBe('हिन्दी');
  });
});
