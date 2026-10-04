# Deployment

Server layout: code `/opt/stormhacks`, DB `/var/lib/stormhacks/stormhacks.db` (outside git, backed up to `backups/` before each deploy), service `stormhacks` on `127.0.0.1:8765`, Caddy terminates TLS for otternonsense.tech.

## One-time setup
1. DNS: `A` (and `AAAA`) records for `otternonsense.tech` and `www` -> VPS IP.
2. On the VPS as root: `sudo bash deploy/setup-server.sh` (or curl it from GitHub raw).
3. Generate a deploy key locally: `ssh-keygen -t ed25519 -f deploy_key -N "" -C github-deploy`
4. On the VPS, authorize it, locked to the deploy script:
   ```
   sudo -u stormhacks install -d -m 700 /home/stormhacks/.ssh
   echo 'command="/opt/stormhacks/deploy/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... github-deploy' \
     | sudo -u stormhacks tee -a /home/stormhacks/.ssh/authorized_keys
   ```
5. GitHub repo -> Settings -> Secrets and variables -> Actions:
   - `DEPLOY_HOST`: VPS IP or hostname
   - `DEPLOY_SSH_KEY`: contents of `deploy_key` (private)
   - `DEPLOY_KNOWN_HOSTS`: output of `ssh-keyscan -t ed25519 <host>`
6. Delete the local `deploy_key` afterwards.

## Existing database
Copy it before running setup, or any time (service stopped):
`scp backend/stormhacks.db root@VPS:/var/lib/stormhacks/ && ssh root@VPS chown stormhacks: /var/lib/stormhacks/stormhacks.db`

## Operations
- Logs: `journalctl -u stormhacks -f`; status: `systemctl status stormhacks caddy`
- Manual deploy: Actions tab -> Deploy -> Run workflow
- Restore: stop service, copy a file from `/var/lib/stormhacks/backups/` over the DB, start service.
