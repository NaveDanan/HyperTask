import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../transport', () => ({ hyperOpenBotRequest: vi.fn() }));
import { hyperOpenBotRequest } from '../transport';
import { hyperAddConnectionServer, hyperAuthorizationUrl, hyperConnectionRows, hyperLoadConnections, hyperStartConnection, type HyperConnectionDirectory } from './HyperConnectionsApi';
const request = vi.mocked(hyperOpenBotRequest);
const directory: HyperConnectionDirectory = { servers: [{ id: 'a', title: 'App', summary: '', url: 'https://example.com/mcp', tools: [] }], catalogue: [{ key: 'b', title: 'Available', summary: '', auth: 'user-oauth' }] };
describe('Hyper connections contracts', () => {
  beforeEach(() => request.mockReset());
  it('keeps revoked, unverified, shared and available states distinct', () => {
    expect(hyperConnectionRows(directory, [{ serverId: 'a', scope: '', connectedAt: '', revoked: true }]).find(r => r.key === 'a')?.state).toBe('Reconnect required');
    expect(hyperConnectionRows(directory, [{ serverId: 'a', scope: '', connectedAt: '', verified: false }]).find(r => r.key === 'a')?.state).toBe('Connection needs checking');
    const shared = { ...directory, servers: [{ ...directory.servers[0], accountMode: 'shared' as const }] };
    expect(hyperConnectionRows(shared, [{ serverId: 'a', holder: 'deployment', connected: false, scope: '', connectedAt: '' }]).find(r => r.key === 'a')?.state).toBe('Team account not connected');
    expect(hyperConnectionRows(directory, []).find(r => r.key === 'b')?.state).toBe('Available');
  });
  it('fails the directory if connection state cannot be read', async () => {
    request.mockResolvedValueOnce(directory).mockRejectedValueOnce(new Error('Offline'));
    await expect(hyperLoadConnections()).rejects.toThrow('Offline');
  });
  it('starts desktop consent with an encoded server id and never confirms it', async () => {
    request.mockResolvedValue({ authorizationUrl: 'https://vendor.example/consent' });
    await hyperStartConnection('a/b');
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/plugins/servers/a%2Fb/connect?returnTo=settings&from=desktop', 'POST');
  });
  it('adds a server by the original contract without credentials', async () => {
    await hyperAddConnectionServer(' Test ', 'https://example.com/mcp');
    expect(request).toHaveBeenCalledWith('/api/plugins/servers/by-url', 'POST', { title: 'Test', url: 'https://example.com/mcp' });
    await expect(hyperAddConnectionServer('Test', 'https://user:password@example.com')).rejects.toThrow();
  });
  it('rejects executable and credential-bearing authorization URLs', () => {
    for (const value of ['javascript:alert(1)', 'file:///tmp/test', 'http://example.com', 'https://user:pass@example.com']) expect(() => hyperAuthorizationUrl(value)).toThrow();
    expect(hyperAuthorizationUrl('https://vendor.example/consent?state=123')).toBe('https://vendor.example/consent?state=123');
  });
});
