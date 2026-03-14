# trust

A simple trust and reputation system for selected media sites.

Extracts speculative claims from NYT political journalism, stores them in a database, and tracks whether they come true over time.

## Setup

1. Clone the repo and install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and add your API keys:

   ```sh
   cp .env.example .env
   ```

   - NYT API key: https://developer.nytimes.com/get-started
   - Anthropic API key: https://console.anthropic.com

## Build

```sh
npm run build
```

## Commands

```sh
npm run extract     # fetch NYT articles and extract speculative claims into the DB
npm run check       # check pending speculations against recent news
npm run check:qa    # same, but review each assessment interactively before saving
npm run report      # display all speculations and journalist summary
npm run edit        # edit or correct an existing assessment
```
