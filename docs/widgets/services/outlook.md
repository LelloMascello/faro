---
title: Outlook
description: Microsoft Outlook / Microsoft 365 inbox preview widget
---

Shows the unread inbox count and previews of the latest messages from an Outlook.com or Microsoft 365 mailbox via Microsoft Graph.

## Configuration

```yaml
- Outlook:
    icon: microsoft-outlook.svg
    description: Università
    href: https://outlook.office.com/mail/
    widget:
      type: outlook
      account: polimi # key in config/faro-oauth.json
      maxItems: 3 # optional - defaults to 3 (max 20)
      focusedOnly: false # optional - only show Focused Inbox messages
      demo: false # optional - set true for sample data without credentials
```

## OAuth2 Setup (Microsoft Entra ID)

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) (a free personal Microsoft account works) and go to **Identity → Applications → App registrations → New registration**.
2. Set a name (e.g. `Faro Dashboard`) and choose **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts** so both university and personal accounts can sign in. Leave _Redirect URI_ blank.
3. Copy the **Application (client) ID** from the app's _Overview_ page.
4. Under **Authentication → Advanced settings**, set **Allow public client flows** to **Yes** and click **Save** (required for Device Code Flow).
5. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, ensure `User.Read`, `Mail.Read`, and `offline_access` are added.
6. Run the one-time CLI linker:
   ```bash
   # Local development
   pnpm faro:auth outlook --account polimi

   # Inside Docker container
   docker exec -it -u 1000 faro node scripts/faro-auth.mjs outlook --account polimi
   ```
   Open `https://microsoft.com/devicelogin` in any browser and enter the short code printed in the terminal.

### Note on University / Organizational Accounts

Some university Microsoft 365 tenants restrict user consent for third-party Graph apps (`Mail.Read`). If sign-in displays **"Need admin approval"** (`AADSTS65001` / `AADSTS90094`), either request consent from your institution's IT helpdesk or link a personal Outlook account (and optionally forward institutional mail to it).

Microsoft rotates refresh tokens automatically; Faro persists each rotated token atomically in `config/faro-oauth.json`.
