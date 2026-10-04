# Coretech by Jamal

## Run locally

1. Copy `.env.example` to `.env` and set the Google and Supabase values described below.
2. In Google Cloud Console, add `http://localhost:5500/auth/callback` as an authorized redirect URI for the OAuth web client.
3. Run `npm install`, then `npm start` and open `http://localhost:5500`.

The server reads `.env` locally. Do not commit `.env`; `.gitignore` excludes it. For deployment, run the Node server on a host that supports backend routes and set the credentials in that host's environment. Set `GOOGLE_REDIRECT_URI` to the exact HTTPS callback URL configured in Google Cloud Console.
## Deploy on Render

Create a Render **Web Service** for this repository with build command `npm install` and start command `npm start`. The server binds to `0.0.0.0` and uses Render's `PORT` environment variable. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (for example, `https://your-service.onrender.com/auth/callback`), `SUPABASE_DATABASE_PASSWORD`, and `SUPABASE_DATABASE_CONNECTION_STRING` in the Render dashboard. If GOOGLE_REDIRECT_URI is omitted or still points to localhost, the app derives the callback from Render's RENDER_EXTERNAL_URL. Add the exact callback URL shown in the Render logs to the Google OAuth client's authorized redirect URIs.

Google sign-in requests basic OpenID Connect profile and email scopes. Sessions are stored in memory and reset when the server restarts.

## Supabase user profiles

Set `SUPABASE_DATABASE_PASSWORD` to the database password from Supabase and `SUPABASE_DATABASE_CONNECTION_STRING` to the PostgreSQL connection string from the Supabase dashboard. The password is supplied separately and replaces any password in the connection string. PostgreSQL SSL is disabled, including SSL options in the connection string. This requires the Supabase project to allow non-SSL database connections; database traffic will be unencrypted.

After a successful Google sign-in, the server creates `public.users` if it does not exist, enables row-level security, and inserts or updates the verified Google profile. The table uses Google's stable subject ID as its primary key. The database role in the connection string needs permission to create and write the table. No client-facing row-level security policies are added.
