# OpenClaw Gateway Invariants

Paperclip supports OpenClaw through `openclaw_gateway` only.

## Transport

- Gateway URL must be `ws://` or `wss://`.
- Do not use `/v1/responses` or `/hooks/*` for this flow.

## Auth

Preferred header:

- `headers.x-openclaw-token`

Legacy fallback:

- `headers.x-openclaw-auth`

The gateway token usually comes from:

```sh
node -p 'require(process.env.HOME+"/.openclaw/openclaw.json").gateway.auth.token'
```

## Device Auth

- Keep device auth enabled by default.
- `disableDeviceAuth` should be false or absent for normal onboarding.
- A stable `devicePrivateKeyPem` should exist so pairing approvals are reused.

## Pairing

First run may still fail with `pairing required`.

If that happens, approve the pending device in OpenClaw and retry. Typical local
approval command:

```sh
openclaw devices approve --latest --url <gateway-ws-url> --token <gateway-token>
```

## Logging

`paperclipai heartbeat run` will surface gateway logs such as:

- `[openclaw-gateway] ...`
- `[openclaw-gateway:event] run=<id> stream=<stream> data=<json>`
