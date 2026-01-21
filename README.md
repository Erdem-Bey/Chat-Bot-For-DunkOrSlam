DunkOrSlum Twitch Assistant Bot
-------------------------------

A personal Node.js Twitch chat assistant designed for the DunkOrSlum stream.

This bot listens to chat messages and reacts automatically to specific events such as:

- new subscriptions and re-subscriptions
- gifted subscriptions
- shop openings
- streamer commands
- certain bot or user messages

It is intentionally non-generic and tailored to the behavior, culture, and flow of a specific Twitch channel.


Features
--------

- Automatically reacts to WizeBot subscription messages by sending "dnkM" (with variants to avoid duplicate-message restrictions).
- Automatically buys items when the in-stream shop opens ("!open").
- Handles gifted subs, new subs, and re-subs differently for logging.
- Ignores or humorously responds to fake subscription messages.
- Automatically votes on bets.
- Automatic "reopen" messages after a bet closes.
- Fully automatic OAuth token refresh (no manual re-login once set up).
- Timestamped console logging for long-running sessions.


Requirements
------------

Node.js (LTS version)
Download from:
https://nodejs.org

A Twitch account that will act as the bot (your own account).


Installation
------------

1) Clone the repository

git clone <repository-url>
cd <repository-folder>

2) Install dependencies

npm install

This command automatically creates the "node_modules" directory.
Do not create "node_modules" manually.


Environment Configuration
-------------------------

Read "Setup.txt".


Customization
-------------

Most behavior is controlled via constants near the top of index.js, including:

- which shop item to buy
- whether to vote in bets
- reopen request behavior
- reply cooldowns
- message variants

This project is intentionally code-configured, not UI-configured.


Notes
-----

This bot is designed for personal use, not mass distribution.
It assumes familiarity with the channel’s culture and commands.
Use at your own risk.
