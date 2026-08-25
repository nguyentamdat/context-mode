# Tailscale Intercom

Intercom remains local-only unless these environment variables are set. Configure the **same random token** on each participating device; do not commit it.

## Homeserver broker

Set these before launching Pi on `homeserver`:

```bash
export PI_INTERCOM_TAILSCALE_HOST=100.108.131.96
export PI_INTERCOM_TAILSCALE_PORT=43765
export PI_INTERCOM_TAILSCALE_TOKEN='<generate-a-long-random-secret>'
export PI_INTERCOM_TAILSCALE_BROKER=1
```

The broker binds only to the specified Tailscale address. Keep the Tailscale ACL restricted to `LAP15400` (or the intended devices) on TCP port `43765`.

## LAP15400 client

In PowerShell before launching Pi:

```powershell
$env:PI_INTERCOM_TAILSCALE_HOST = '100.108.131.96'
$env:PI_INTERCOM_TAILSCALE_PORT = '43765'
$env:PI_INTERCOM_TAILSCALE_TOKEN = '<the-same-secret>'
```

Do **not** set `PI_INTERCOM_TAILSCALE_BROKER` on clients. Clients never auto-spawn a local broker in this mode.

After both Pi instances start, `intercom({ action: "list" })` should show sessions from both machines. The shared token is application authentication; Tailscale provides encrypted network transport and ACL enforcement.
