import { ErrorCode } from '@shared/protobuf/flowy-error/code_pb';
import type { PublishInfoViewPB } from '@shared/protobuf/flowy-folder/publish_pb';

// Pure parts of the Sites page (pages/sites/**, plugins/shared/share/constants.dart,
// shared/error_code/error_code_map.dart).

/** `addSchemaIfNeeded`: https:// when the string has no URI scheme. */
export function addSchemaIfNeeded(url: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
}

/** ShareConstants.buildPublishUrl. */
export const buildPublishUrl = (baseWebDomain: string, nameSpace: string, publishName: string) =>
  addSchemaIfNeeded(`${baseWebDomain}/${nameSpace}/${publishName}`);

/** ShareConstants.buildNamespaceUrl: without the https:// prefix unless asked. */
export function buildNamespaceUrl(baseWebDomain: string, nameSpace: string, withHttps = false): string {
  let url = addSchemaIfNeeded(baseWebDomain);
  if (!withHttps) url = url.replace('https://', '');
  return `${url}/${nameSpace}`;
}

/** SettingsSitesBloc._fetchPublishedViews: newest first. */
export function sortPublishedViews(views: PublishInfoViewPB[]): PublishInfoViewPB[] {
  return [...views].sort((a, b) => Number((b.info?.publishTimestampSec ?? 0n) - (a.info?.publishTimestampSec ?? 0n)));
}

/** DomainErrorCodeMap.namespaceErrorMessage (i18n key), null for other codes. */
export function namespaceErrorKey(code: ErrorCode): string | null {
  switch (code) {
    case ErrorCode.CustomNamespaceRequirePlanUpgrade:
      return 'settings.sites.error.proPlanLimitation';
    case ErrorCode.CustomNamespaceAlreadyTaken:
      return 'settings.sites.error.namespaceAlreadyInUse';
    case ErrorCode.InvalidNamespace:
    case ErrorCode.InvalidRequest:
      return 'settings.sites.error.invalidNamespace';
    case ErrorCode.CustomNamespaceTooLong:
      return 'settings.sites.error.namespaceTooLong';
    case ErrorCode.CustomNamespaceTooShort:
      return 'settings.sites.error.namespaceTooShort';
    case ErrorCode.CustomNamespaceReserved:
      return 'settings.sites.error.namespaceIsReserved';
    case ErrorCode.CustomNamespaceInvalidCharacter:
      return 'settings.sites.error.namespaceContainsInvalidCharacters';
    default:
      return null;
  }
}

/** PublishNameErrorCodeMap.publishErrorMessage (i18n key), null for other codes. */
export function publishNameErrorKey(code: ErrorCode): string | null {
  switch (code) {
    case ErrorCode.PublishNameAlreadyExists:
      return 'settings.sites.error.publishNameAlreadyInUse';
    case ErrorCode.PublishNameInvalidCharacter:
      return 'settings.sites.error.publishNameContainsInvalidCharacters';
    case ErrorCode.PublishNameTooLong:
      return 'settings.sites.error.publishNameTooLong';
    case ErrorCode.UserUnauthorized:
      return 'settings.sites.error.publishPermissionDenied';
    case ErrorCode.ViewNameInvalid:
      return 'settings.sites.error.publishNameCannotBeEmpty';
    default:
      return null;
  }
}
