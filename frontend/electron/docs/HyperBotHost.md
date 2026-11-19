# Hyper-Bot host mode

Desktop Hyper-Bot uses Settings → AI and runs while HyperTask is open. The optional headless host owns a separate Hyper-Bot state directory and runs recurring prompts when the desktop is closed. Connect the desktop to the host before creating routines you want to run there. Local and hosted conversations have separate histories.

## Run the host

From `frontend/electron`, install the package dependencies and run `npm run build:bot-host`. Run `npm run bot-host` with the environment below in a persistent service manager. Use one process per state directory. The service writes its process ID to `host.lock` and releases the lock on graceful shutdown. After an abrupt shutdown, verify that the process is gone before removing the stale lock.

| Host setting | Value |
| --- | --- |
| `HYPER_BOTS_HOST_STATE` | Private persistent directory for chats, attachments, workspace files, routines, and vault data |
| `HYPER_BOTS_HOST_PORT` | Loopback port, default `4320` |
| `HYPER_BOTS_HOST_OWNER` | Native HyperTask account key of the one owner of this instance |
| `HYPER_BOTS_HOST_TOKEN` | Separate random 32-byte base64url token |
| `HYPER_BOTS_MODEL_URL` | OpenAI-compatible API base URL, including its version path |
| `HYPER_BOTS_MODEL` | Default model ID |
| `HYPER_BOTS_MODEL_KEY` | API key for the model endpoint, if required |
| `HYPER_BOTS_VAULT_KEY` | Optional separate 32-byte base64url key for vault encryption |
| `HYPER_BOTS_JIRA_URL`, `HYPER_BOTS_JIRA_PROJECT`, `HYPER_BOTS_JIRA_TOKEN` | Optional HTTPS Jira URL, project, and personal access token. The host must be able to reach Jira. |
| `HYPER_BOTS_WEB_ORIGINS` | Optional comma-separated HTTPS origins for the webpage-reading tool. Each call requires approval. |

Store keys and tokens in your service manager's protected environment. Keep the vault key with the backups for the state directory. The host binds to `127.0.0.1`. Expose it through an authenticated network path such as an SSH port forward or an HTTPS reverse proxy. Forward `/rpc` and `/events`, preserve the Authorization header, and disable response buffering for `/events`.

## Connect HyperTask

On the desktop, set `HYPER_BOTS_HOST_URL` to the HTTPS proxy URL or a loopback tunnel URL. Set `HYPER_BOTS_HOST_TOKEN` and `HYPER_BOTS_HOST_OWNER` to the host values. Restart HyperTask. To obtain the owner key, launch the desktop once with `HYPER_BOTS_PRINT_OWNER=1` and check its main-process output after signing in. The desktop only opens the host for the matching native account.

Classic Outlook uses the Windows desktop runtime. Configure Jira on the host separately. Routines use elapsed minutes from their first scheduled time and start at most the latest missed slot when the runtime comes back online. Pending approvals wait for the owner. Text-file commands operate inside the bot workspace, and webpage reading retrieves text from configured origins. Dictation uses the model endpoint's `audio/transcriptions` route with `whisper-1`.
