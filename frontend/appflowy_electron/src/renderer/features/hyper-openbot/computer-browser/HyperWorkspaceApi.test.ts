import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn(), hyperOpenBotFetch: vi.fn(), HYPER_OPENBOT_ORIGIN: 'https://hyper-openbot.invalid' }));
import { hyperOpenBotRequest, hyperOpenBotFetch } from '../transport';
import { hyperListFiles, hyperReadFile, hyperWriteFile, hyperDownloadFile } from './HyperWorkspaceApi';
const request = vi.mocked(hyperOpenBotRequest); const fetch = vi.mocked(hyperOpenBotFetch);
beforeEach(() => { request.mockReset(); fetch.mockReset(); });
it('lists the workspace and reads an encoded computer identity with exact bodies', async () => {
  await hyperListFiles('bot id', ''); await hyperListFiles('bot', ' reports '); await hyperReadFile('bot', ' reports/a.txt ');
  expect(request.mock.calls).toEqual([['/api/computers/bot%20id/files/list', 'POST', {}], ['/api/computers/bot/files/list', 'POST', { path: 'reports' }], ['/api/computers/bot/files/read', 'POST', { path: 'reports/a.txt' }]]);
});
it('reads back an overwrite from the server and preserves exact file contents', async () => {
  const result = { path: 'a', text: 'normalized', bytes: 10, truncated: false }; request.mockResolvedValueOnce({}).mockResolvedValueOnce(result);
  expect(await hyperWriteFile('bot', ' a ', ' <script>inert</script>\n')).toEqual(result);
  expect(request.mock.calls[0]).toEqual(['/api/computers/bot/files/write', 'POST', { path: 'a', contents: ' <script>inert</script>\n', append: false }]);
});
it('does not claim a successful write after refusal', async () => {
  request.mockRejectedValueOnce(new Error('Refused')); await expect(hyperWriteFile('bot', 'a', 'draft')).rejects.toThrow('Refused'); expect(request).toHaveBeenCalledTimes(1);
});
it('downloads opaque bytes through the restricted transport and refuses failed responses', async () => {
  fetch.mockResolvedValueOnce(new Response('<script>x</script>'));
  const blob = await hyperDownloadFile('bot', ' a & b.html '); expect(blob.type).toBe('application/octet-stream'); expect(await blob.text()).toBe('<script>x</script>');
  expect(fetch).toHaveBeenCalledWith('https://hyper-openbot.invalid/api/computers/bot/files/download?path=a%20%26%20b.html');
  fetch.mockResolvedValueOnce(new Response('Refused', { status: 403 })); await expect(hyperDownloadFile('bot', 'a')).rejects.toThrow('refused');
});
