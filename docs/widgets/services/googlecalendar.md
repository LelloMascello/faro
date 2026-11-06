---
title: Google Calendar
description: Daily Google Calendar agenda and interactive Google Tasks widget
---

Displays today's events across your Google Calendars (with per-calendar color bars and Google Meet detection) together with Google Tasks due today or overdue, including an interactive checkbox to mark tasks as completed.

## Configuration

```yaml
- Google Calendar:
    icon: google-calendar.svg
    href: https://calendar.google.com
    widget:
      type: googlecalendar
      account: personale # key in config/faro-oauth.json (can share Gmail's account)
      calendars: [] # optional - empty reads all selected/visible calendars
      showTasks: true # optional - defaults to true
      completeTasks: true # optional - interactive checkbox to complete tasks (defaults to true)
      hidePastEvents: false # optional - hide events that have already ended today
      timezone: Europe/Rome # optional - defaults to primary calendar timezone
      maxItems: 8 # optional - defaults to 8 (max 25)
      demo: false # optional - set true for sample data without credentials
```

## OAuth2 Setup

Uses the same Google OAuth credentials and `faro-oauth.json` entry as the [Gmail](gmail.md) widget (`gmail.readonly`, `calendar.readonly`, and `tasks` scopes).

If you only want read-only task access (disabling completion at the OAuth scope level), pass `--no-tasks-write` when linking:

```bash
pnpm faro:auth google --account personale --no-tasks-write
```

And set `completeTasks: false` in `services.yaml`.

> **Security note**: When `completeTasks: true` is active, anyone with access to your dashboard can mark due tasks as completed. Enable Homepage authentication if your instance is exposed beyond a trusted network.
