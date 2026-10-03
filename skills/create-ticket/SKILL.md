---
name: create-ticket
description: Use when drafting, creating, filing, or rewriting a GitHub issue, Jira ticket, Zenhub issue, or bug report, and when deciding a ticket title. Covers the body, the title, and how to phrase a bug.
---

# Create a ticket

A ticket is read by one person, on its own, with no memory of the conversation that produced it. Everything below follows from that.

## Before drafting

- Check for templates in the repository or the project. Read a few existing tickets and match how they are written.
- Check whether the ticket already exists.

## The body

- A ticket is self contained. Someone must be able to read it and understand it in isolation. Assume no prior context.
- Links support the ticket. They are never required reading for it to make sense.
- A ticket has a clear purpose. Someone must be able to read it and know what will happen if it is implemented.
- Explain the goal briefly and in non-technical terms first, before the technical detail. Not everyone who reads the issue is an engineer.
- Keep the ticket itself up to date. A comment carrying new information is useful context, but it is not a substitute for updating the ticket body.
- Re-read the draft title and description before filing. Check that it still makes sense with the conversation taken away.

## Titles

Titles must be clear and specific. A title that raises a question has failed.

State a bug as the bug. `Bug: ABC shows a picture for a thing it does not have installed` says plainly that ABC should not be doing that.

## Example: the opening line

Bad, because it never says what is being backfilled and needs context the ticket does not carry:

> A backfill that has no pictures to draw is invisible however many it sends, so there is no way to stop one.

Better:

> Coilbox can send pictures of a game's units to the hub in the background. #1767 added a badge in the topbar so somebody can see that happening and stop it. This should appear on all backfills but it does not, leading to invisible runs.

## Example: the title

Ambiguous, and cannot be understood on its own:

> Show a picture upload that has many to send and none to draw

Which picture upload? Drawing what? Improved, but still unclear:

> Show a background picture upload even when there is nothing to draw

Better:

> Bug: the upload badge does not appear when a hub backfill has no renders to create

It states the problem directly and makes clear that it is a bug.
