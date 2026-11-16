// Generated from rust-lib/hyper-ai/src/event_map.rs by scripts/gen-events.mjs. Do not edit.
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { EMPTY, request, type HyperResult } from '../dispatch';
import { ChatFilePBSchema, ChatIdSchema, ChatInfoPBSchema, ChatMessageIdPBSchema, ChatMessageListPBSchema, ChatMessagePBSchema, ChatSettingsPBSchema, CompleteTextPBSchema, CompleteTextTaskPBSchema, CreateChatContextPBSchema, CustomPromptDatabaseConfigurationPBSchema, LoadNextChatMessagePBSchema, LoadPrevChatMessagePBSchema, LocalAIPBSchema, LocalAISettingPBSchema, ModelSelectionPBSchema, ModelSourcePBSchema, RegenerateResponsePBSchema, RepeatedRelatedQuestionPBSchema, StopStreamPBSchema, StreamChatPayloadPBSchema, UpdateChatSettingsPBSchema, UpdateSelectedModelPBSchema, type ChatInfoPB, type ChatMessageListPB, type ChatMessagePB, type ChatSettingsPB, type CompleteTextTaskPB, type CustomPromptDatabaseConfigurationPB, type LocalAIPB, type LocalAISettingPB, type ModelSelectionPB, type RepeatedRelatedQuestionPB } from '@shared/protobuf/hyper-ai/entities_pb';

export function AIEventLoadPrevMessage(payload: MessageInitShape<typeof LoadPrevChatMessagePBSchema>): Promise<HyperResult<ChatMessageListPB>> {
  return request('LoadPrevMessage', toBinary(LoadPrevChatMessagePBSchema, create(LoadPrevChatMessagePBSchema, payload)), ChatMessageListPBSchema);
}

export function AIEventLoadNextMessage(payload: MessageInitShape<typeof LoadNextChatMessagePBSchema>): Promise<HyperResult<ChatMessageListPB>> {
  return request('LoadNextMessage', toBinary(LoadNextChatMessagePBSchema, create(LoadNextChatMessagePBSchema, payload)), ChatMessageListPBSchema);
}

export function AIEventStreamMessage(payload: MessageInitShape<typeof StreamChatPayloadPBSchema>): Promise<HyperResult<ChatMessagePB>> {
  return request('StreamMessage', toBinary(StreamChatPayloadPBSchema, create(StreamChatPayloadPBSchema, payload)), ChatMessagePBSchema);
}

export function AIEventStopStream(payload: MessageInitShape<typeof StopStreamPBSchema>): Promise<HyperResult<void>> {
  return request('StopStream', toBinary(StopStreamPBSchema, create(StopStreamPBSchema, payload)));
}

export function AIEventGetRelatedQuestion(payload: MessageInitShape<typeof ChatMessageIdPBSchema>): Promise<HyperResult<RepeatedRelatedQuestionPB>> {
  return request('GetRelatedQuestion', toBinary(ChatMessageIdPBSchema, create(ChatMessageIdPBSchema, payload)), RepeatedRelatedQuestionPBSchema);
}

export function AIEventGetAnswerForQuestion(payload: MessageInitShape<typeof ChatMessageIdPBSchema>): Promise<HyperResult<ChatMessagePB>> {
  return request('GetAnswerForQuestion', toBinary(ChatMessageIdPBSchema, create(ChatMessageIdPBSchema, payload)), ChatMessagePBSchema);
}

export function AIEventCompleteText(payload: MessageInitShape<typeof CompleteTextPBSchema>): Promise<HyperResult<CompleteTextTaskPB>> {
  return request('CompleteText', toBinary(CompleteTextPBSchema, create(CompleteTextPBSchema, payload)), CompleteTextTaskPBSchema);
}

export function AIEventStopCompleteText(payload: MessageInitShape<typeof CompleteTextTaskPBSchema>): Promise<HyperResult<void>> {
  return request('StopCompleteText', toBinary(CompleteTextTaskPBSchema, create(CompleteTextTaskPBSchema, payload)));
}

export function AIEventChatWithFile(payload: MessageInitShape<typeof ChatFilePBSchema>): Promise<HyperResult<void>> {
  return request('ChatWithFile', toBinary(ChatFilePBSchema, create(ChatFilePBSchema, payload)));
}

export function AIEventRestartLocalAI(): Promise<HyperResult<void>> {
  return request('RestartLocalAI', EMPTY);
}

export function AIEventToggleLocalAI(): Promise<HyperResult<LocalAIPB>> {
  return request('ToggleLocalAI', EMPTY, LocalAIPBSchema);
}

export function AIEventGetLocalAIState(): Promise<HyperResult<LocalAIPB>> {
  return request('GetLocalAIState', EMPTY, LocalAIPBSchema);
}

export function AIEventCreateChatContext(payload: MessageInitShape<typeof CreateChatContextPBSchema>): Promise<HyperResult<void>> {
  return request('CreateChatContext', toBinary(CreateChatContextPBSchema, create(CreateChatContextPBSchema, payload)));
}

export function AIEventGetChatInfo(payload: MessageInitShape<typeof ChatIdSchema>): Promise<HyperResult<ChatInfoPB>> {
  return request('GetChatInfo', toBinary(ChatIdSchema, create(ChatIdSchema, payload)), ChatInfoPBSchema);
}

export function AIEventGetChatSettings(payload: MessageInitShape<typeof ChatIdSchema>): Promise<HyperResult<ChatSettingsPB>> {
  return request('GetChatSettings', toBinary(ChatIdSchema, create(ChatIdSchema, payload)), ChatSettingsPBSchema);
}

export function AIEventUpdateChatSettings(payload: MessageInitShape<typeof UpdateChatSettingsPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateChatSettings', toBinary(UpdateChatSettingsPBSchema, create(UpdateChatSettingsPBSchema, payload)));
}

export function AIEventRegenerateResponse(payload: MessageInitShape<typeof RegenerateResponsePBSchema>): Promise<HyperResult<void>> {
  return request('RegenerateResponse', toBinary(RegenerateResponsePBSchema, create(RegenerateResponsePBSchema, payload)));
}

export function AIEventGetLocalAISetting(): Promise<HyperResult<LocalAISettingPB>> {
  return request('GetLocalAISetting', EMPTY, LocalAISettingPBSchema);
}

export function AIEventUpdateLocalAISetting(payload: MessageInitShape<typeof LocalAISettingPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateLocalAISetting', toBinary(LocalAISettingPBSchema, create(LocalAISettingPBSchema, payload)));
}

export function AIEventGetSettingModelSelection(payload: MessageInitShape<typeof ModelSourcePBSchema>): Promise<HyperResult<ModelSelectionPB>> {
  return request('GetSettingModelSelection', toBinary(ModelSourcePBSchema, create(ModelSourcePBSchema, payload)), ModelSelectionPBSchema);
}

export function AIEventUpdateSelectedModel(payload: MessageInitShape<typeof UpdateSelectedModelPBSchema>): Promise<HyperResult<void>> {
  return request('UpdateSelectedModel', toBinary(UpdateSelectedModelPBSchema, create(UpdateSelectedModelPBSchema, payload)));
}

export function AIEventGetLocalModelSelection(): Promise<HyperResult<ModelSelectionPB>> {
  return request('GetLocalModelSelection', EMPTY, ModelSelectionPBSchema);
}

export function AIEventGetSourceModelSelection(payload: MessageInitShape<typeof ModelSourcePBSchema>): Promise<HyperResult<ModelSelectionPB>> {
  return request('GetSourceModelSelection', toBinary(ModelSourcePBSchema, create(ModelSourcePBSchema, payload)), ModelSelectionPBSchema);
}

export function AIEventGetCustomPromptDatabaseConfiguration(): Promise<HyperResult<CustomPromptDatabaseConfigurationPB>> {
  return request('GetCustomPromptDatabaseConfiguration', EMPTY, CustomPromptDatabaseConfigurationPBSchema);
}

export function AIEventSetCustomPromptDatabaseConfiguration(payload: MessageInitShape<typeof CustomPromptDatabaseConfigurationPBSchema>): Promise<HyperResult<void>> {
  return request('SetCustomPromptDatabaseConfiguration', toBinary(CustomPromptDatabaseConfigurationPBSchema, create(CustomPromptDatabaseConfigurationPBSchema, payload)));
}
