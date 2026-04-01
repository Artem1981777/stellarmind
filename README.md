# StellarMind

AI Agent that pays for tools using Stellar micropayments (x402 pattern)

## Live Demo
https://stellarmind-five.vercel.app

## How it works
1. User asks a question
2. Agent selects required tools
3. Agent pays with real XLM on Stellar testnet
4. Returns answer with verifiable TX receipts

## Features
- AI Agent with autonomous tool selection
- x402 Micropayments - real Stellar testnet transactions
- Agent-to-Agent (A2A) payments
- Soroban Spending Limits
- Transaction History with Stellar Explorer links

## Tech Stack
- React + TypeScript + Vite
- @stellar/stellar-sdk
- Stellar Testnet (Horizon API)
- Claude AI (Anthropic)
- Vercel

## Tools and Costs
- Web Search: 0.001 XLM
- Data Analysis: 0.002 XLM
- Code Execution: 0.003 XLM
- Image Analysis: 0.005 XLM
- Premium API: 0.010 XLM

## Built for Stellar Hacks Agents 2026
Prize pool: $10,000 in XLM
