# Coretech by Jamal

## Run locally

1. Copy `.env.example` to `.env` and set the Google and Supabase values described below.
2. In Google Cloud Console, add `http://localhost:5500/auth/callback` as an authorized redirect URI for the OAuth web client.
3. Run `npm install`, then `npm start` and open `http://localhost:5500`.

The server reads `.env` locally. Do not commit `.env`; `.gitignore` excludes it. For deployment, run the Node server on a host that supports backend routes and set the credentials in that host's environment. Set `GOOGLE_REDIRECT_URI` to the exact HTTPS callback URL configured in Google Cloud Console.

Google sign-in requests basic OpenID Connect profile and email scopes. Sessions are stored in memory and reset when the server restarts.

## Supabase user profiles

Set `SUPABASE_DATABASE_PASSWORD` to the database password from Supabase and `SUPABASE_DATABASE_CONNECTION_STRING` to the PostgreSQL connection string from the Supabase dashboard. The password is supplied separately and replaces any password in the connection string. The server requires an encrypted SSL connection and never sends these values to the browser. For server certificate verification, download the project's root certificate from Supabase Database Settings and set `SUPABASE_DATABASE_SSL_CA_PATH` to its local path; without that certificate, SSL encrypts traffic but does not verify the server identity.

After a successful Google sign-in, the server creates `public.users` if it does not exist, enables row-level security, and inserts or updates the verified Google profile. The table uses Google's stable subject ID as its primary key. The database role in the connection string needs permission to create and write the table. No client-facing row-level security policies are added.
