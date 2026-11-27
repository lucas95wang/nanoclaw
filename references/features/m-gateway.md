# Mechanism · Credential gateway (OneCLI)

## What it is

The agent container never holds the Anthropic credential. Setup installs a gateway (OneCLI by default, `onecli` + `onecli-postgres-1` Docker containers, pinned 1.45.0) and registers the model credential in its vault (`claude setup-token` OAuth token or an API key). Per session, `ensureGatewaySession` (`src/gateway-providers/onecli.ts`, copied in by `/add-onecli`) ensures a OneCLI agent for the agent group, grants it the credential, and returns a typed contribution: env (`HTTPS_PROXY=http://host.docker.internal:<port>`, `SSL_CERT_FILE`, `DENO_CERT`, `ANTHROPIC_AUTH_TOKEN=gateway-managed`, optionally `ANTHROPIC_BASE_URL`), the gateway CA mounted read-only, and a network-access intent. OneCLI terminates TLS with its own CA, injects the real key for allowed hosts (`anthropic.com` for the Claude provider), and forwards. It also raises approval events for tools marked "Ask" (see approvals). The lease is monitored every 5 s; when the gateway becomes unavailable the host stops the session and refuses new admissions until it is back.

## How a user triggers it

Setup's credential step; later `pnpm exec tsx setup/index.ts --step gateway` or `/add-onecli`. `onecli secrets list`, `onecli agents grants list`.

## How an agent runs and verifies it

- `docker ps` shows `onecli` healthy; `.env` has `ONECLI_URL` and `NANOCLAW_GATEWAY_PROVIDER=onecli`.
- `curl -s $ONECLI_URL/v1/health` from the host.
- Learning trace `wake:spec` shows `networkAccess` and `contributedEnvKeys`.
- A model turn succeeding is the end-to-end proof (stage 6).

## Where it goes wrong

- `access_restricted` / `credential_not_found` from the proxy: the secret is not attached to this agent → `onecli agents attach-secret`.
- `No gateway provider is registered`: the gateway payload was not applied; re-run the gateway step.
- Gateway down mid-turn: the session is stopped (`Gateway session became unavailable`), the message goes back to pending and is retried once the gateway heals.
- Host `.env` `ANTHROPIC_BASE_URL` is only honoured through the gateway contribution, never passed raw.

## Version-specific

- Seam docs `docs/gateway-seam.md`; approval coordinator `src/gateway-approval-coordinator.ts`; OneCLI SDK `@onecli-sh/sdk@2.2.1`; this install: `ONECLI_URL=http://172.17.0.1:10254` (310f739b + `setup: apply add-onecli`).
