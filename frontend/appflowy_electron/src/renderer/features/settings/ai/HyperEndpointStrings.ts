export const hyperEndpointStrings = {
  defaultModel: 'Default chat model', selectModel: 'Search or select a model',
  modelHelp: 'Choose a model returned by this endpoint, then save to make it the default. You can also enter an exact model ID.',
  defaultDescription: 'New chats and AI actions use this default unless a model is selected for that conversation.',
  currentDefault: 'Selected default: {model}', useManual: 'Use entered model ID',
  noMatch: 'No matching models. You can enter a model ID manually.',
  checking: 'Discovering endpoint models…', waiting: 'Waiting for endpoint details…',
  connected: 'Endpoint connected. {count} model IDs available.',
  empty: 'Endpoint connected, but it returned no models. Enter a model ID manually or check endpoint permissions.',
  notListed: 'The selected default is not listed by this endpoint. You can keep its exact ID or choose another model.',
  refresh: 'Refresh models', autoHelp: 'The address and API key are checked automatically after you finish typing.',
  selectedTest: 'Test selected model',
} as const;
