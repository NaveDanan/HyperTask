// English fallback while locale files adopt the new chat controls.
export const hyperChatStrings = {
  title: 'AI chat', model: 'Model', defaultModel: 'Configured model', sources: 'Sources', sourceSearch: 'Search pages',
  selectedSources: 'Selected pages are sent to the configured AI service when used as context.',
  noSources: 'No pages match this search.', unknownSource: 'Unavailable selected page', clearSources: 'Clear selected pages',
  user: 'You', assistant: 'Assistant', system: 'System', send: 'Send message', stop: 'Stop generating', stopping: 'Stopping…',
  input: 'Message', placeholder: 'Ask a question…', hint: 'Enter to send · Shift+Enter for a new line', copy: 'Copy message',
  loading: 'Loading chat…', loadOlder: 'Load earlier messages', retry: 'Retry loading', empty: 'Start a conversation',
  emptyHint: 'Messages are saved in this workspace. Configure your AI endpoint in Settings → AI before sending.',
  readOnly: 'This chat is read-only.', error: 'Chat needs attention', generating: 'Generating…',
  modelError: 'Could not load or update AI models.', sourceError: 'Could not load or update sources.',
  sourcePicker: 'Choose pages for context',
} as const;
