---
title: Gmail
description: Gmail inbox preview and unread counter widget
---

Shows the unread inbox count and previews of the most recent messages for a linked Google account.

## Configuration

```yaml
- Gmail:
    icon: gmail.svg
    description: Personale
    href: https://mail.google.com
    widget:
      type: gmail
      account: personale # key in config/faro-oauth.json
      maxItems: 3 # optional - defaults to 3 (max 20)
      query: "in:inbox" # optional - Gmail search syntax
      demo: false # optional - set true for sample data without credentials
```

## OAuth2 Setup (Google Cloud)

One Google OAuth setup covers both the **Gmail** and **Google Calendar** widgets.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g. `Faro`).
2. Under **APIs & Services → Library**, enable:
   - **Gmail API**
   - **Google Calendar API**
   - **Google Tasks API**
3. Under **Google Auth Platform / OAuth consent screen**:
   - Choose **External** user type and fill the required app name and email fields.
   - Publish the app (**Publish App → In production**). _Important_: apps left in _Testing_ expire refresh tokens after **7 days**. Personal unverified apps do not require Google verification — click _Advanced → Go to Faro (unsafe)_ once during login.
4. Under **Credentials → Create Credentials → OAuth client ID**:
   - Select **Desktop app** and copy the **Client ID** and **Client Secret**.
5. Run the one-time CLI linker:
   ```bash
   # Local development
   pnpm faro:auth google --account personale

   # Inside Docker container (run as UID 1000 so the app can update the file)
   docker exec -it -u 1000 faro node scripts/faro-auth.mjs google --account personale
   ```
   If running on a headless server via SSH or Docker where `http://127.0.0.1:...` cannot load in your local browser, copy the full redirect URL from your browser's address bar and paste it into the terminal prompt.

Tokens are stored with `0600` permissions in `config/faro-oauth.json` and refreshed automatically.
