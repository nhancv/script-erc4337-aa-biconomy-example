# DEVELOPMENT

https://docs.biconomy.io/tutorials/sendGasless

## Config Biconomy

- Create a new account on Biconomy: https://dashboard.biconomy.io
- Create new Paymaster
- Setup Gas-Tank -> Deposit Funds (ETH)
- Setup Rules:
  - Turn `OFF` **Sponsor Wallet Deployments Only**
  - Whitelist all Contracts to be used -> Enable used methods only
  - Config Spending limits

## Install dep

```
git clone git@github.com.....
cd script-erc4337-aa-biconomy-example
yarn install
```

## Prepare environment config

```
cp .env.example .env

# Update .env content
# Setup other secret configs as well
```

## Local dev

- Normal mode - without monitor

```
yarn start
```

- Monitor mode

```
yarn start:dev
```

## Build production

```
yarn build
```
