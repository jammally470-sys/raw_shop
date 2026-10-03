# Coretech by Jamal

## Run locally

1. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
2. In Google Cloud Console, add `http://localhost:5500/auth/callback` as an authorized redirect URI for the OAuth web client.
3. From this folder, run `node dev-server.js` and open `http://localhost:5500`.

The server reads `.env` locally. Do not commit `.env`; `.gitignore` excludes it. For deployment, run the Node server on a host that supports backend routes and set the credentials in that host's environment. Set `GOOGLE_REDIRECT_URI` to the exact HTTPS callback URL configured in Google Cloud Console.

Google sign-in requests basic OpenID Connect profile and email scopes. Sessions are stored in memory and reset when the server restarts.
