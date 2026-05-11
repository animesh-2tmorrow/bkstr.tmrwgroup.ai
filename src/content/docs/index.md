# bkstr docs

Welcome to bkstr. This page contains operational guidance for using the platform. Sections below are filtered to your role — you only see what applies to you.

## Getting started

*(placeholder)* Account setup, signing in, finding your way around the dashboard. This section is visible to everyone signed in.

:::role subscriber
## For subscribers

*(placeholder)* How to buy books from the Library, view your purchases on the Billing page, and use the agent fetch API to query book content programmatically. The View and Download buttons on books you have access to render the raw markdown directly.
:::

:::role publisher
## For publishers

*(placeholder)* How to upload new books via the New Book form, set and update USD pricing on the Pricing page, and check which of your books have active grants. Edward + Zach will see this section.
:::

:::role admin
## For admins

*(placeholder)* User management at Admin · Users (promote SUBSCRIBER → PUBLISHER, demote, view last signin). Book ownership reassignment at Admin · Books. Access grant revocation at Admin · Grants. Every admin mutation writes a row to `admin_actions` for audit; query via psql per the runbook in `docs/operations.md`.
:::

## Need more help?

*(placeholder)* If you hit something this docs page doesn't cover, contact animesh@2tmorrow.com. This section is visible to everyone signed in.
