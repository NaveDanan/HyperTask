/// Public entry for the offline template store.
///
/// Wire it up with:
///   LocalTemplateStorePage(user: userProfile)
///
/// `userProfile` is the `UserProfilePB` the rest of the workspace already
/// has. The assets must be declared in pubspec.yaml; see doc/local-templates.md.
library;

export 'data/local_template_converter.dart';
export 'data/local_template_media_writer.dart';
export 'data/local_template_import_service.dart';
export 'data/local_template_models.dart';
export 'data/local_template_repository.dart';
export 'logic/local_template_store_cubit.dart';
export 'logic/local_template_store_state.dart';
export 'presentation/local_template_card.dart';
export 'presentation/local_template_store_page.dart';
