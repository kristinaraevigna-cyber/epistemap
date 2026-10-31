# Deploying EpisteMap (GitHub + Render + Supabase)

The same setup as Evidence Navigator, so the steps will be familiar. Allow about 20 minutes.

## 1. GitHub

1. In GitHub Desktop: **File → Add Local Repository**, choose the project folder (it may still be called `coverage-map` on disk; the folder and repository names do not matter to the app). If it says the folder is not a Git repository, click **create a repository** and keep the defaults.
2. **Publish repository**. Keep it private for now (it can be anonymised or made public later). If the repository is already published as `coverage-map`, you can rename it on GitHub under Settings → General; GitHub redirects the old name and GitHub Desktop follows.

## 2. Supabase (shared storage for fields)

1. In your existing Supabase project, or a new one, open **Project Settings → Database → Connection string**, choose **Session pooler**, and copy the URI (it starts with `postgresql://postgres.`...). Replace `[YOUR-PASSWORD]` with the database password.
2. Nothing else to create: the app makes its two tables (`cm_fields`, `cm_events`) on first start and turns on row-level security so they are not exposed through Supabase's public API.

You can use the same Supabase project as the Navigator; the table names do not clash (`rn_` vs `cm_`).

## 3. Render

1. **New → Blueprint**, select the repository (it may still be called `coverage-map`; the name does not matter to Render). Render reads `render.yaml` and creates one free web service.
2. When asked for environment variables, set:
   - `ANTHROPIC_API_KEY`: your key (the same one as the Navigator is fine; both count against the same budget)
   - `DATABASE_URL`: the Supabase session-pooler string
   - `CONTACT_EMAIL`: your email (OpenAlex gives faster rate limits to requests that identify themselves)
   - `ACCESS_CODE`: leave empty for open access, or set a word to restrict who can run the model
3. Deploy. The first build takes 2–3 minutes. Open the service URL; `/healthz` should say `ok`.

The free plan sleeps after 15 minutes of inactivity; the first request afterwards takes about 30 seconds.

## 4. Check

1. Create a field, add a study by hand, upload its PDF on step 2. If you see "No API key configured on the server", the `ANTHROPIC_API_KEY` variable was not saved.
2. Reload the page: the field should still be there (that confirms Supabase is in use; the logs say `[store] using Postgres`).

## 5. Budget

Reading one paper costs about one model call with a long input (a 30-page PDF is roughly 40–60k input tokens). `DAILY_MODEL_CAP` (default 400 calls/day) is a safety net for open access. Users can also add their own key in Settings; it stays in their browser tab.

## Updating

Push from GitHub Desktop; Render redeploys automatically.
