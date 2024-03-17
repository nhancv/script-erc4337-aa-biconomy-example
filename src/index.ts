require('dotenv').config();
import { JSONFile, Low } from '@commonify/lowdb';

import { createWalletClient, encodeFunctionData, Address, Hex, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createSmartAccountClient, PaymasterMode } from '@biconomy/account';

import nftContractAbi from './abis/NFTContract.json';

const chain = sepolia;
const biconomyPaymasterApiKey = process.env.BICONOMY_PAYMASTER_API_KEY as string;
const bundlerUrl = process.env.BICONOMY_BUNDLER_URL as string;

const initUser = async () => {
  const cache = new Low<{ scwAddress: Hex; address: Hex; pk: Hex }>(new JSONFile(`${process.cwd()}/.cache.json`));
  await cache.read();

  const privKeyHex = cache.data?.pk ?? (generatePrivateKey() as Hex);

  // Generate EOA from private key using ethers.js
  const owner = privateKeyToAccount(privKeyHex);
  const signer = createWalletClient({
    account: owner,
    chain: chain,
    transport: http(),
  });
  // Create Biconomy Smart Account instance
  const smartWallet = await createSmartAccountClient({
    signer: signer as any,
    biconomyPaymasterApiKey: biconomyPaymasterApiKey,
    bundlerUrl: bundlerUrl,
  });

  const saAddress = await smartWallet.getAccountAddress();
  console.log('SA Address', saAddress);

  if (!cache.data) {
    cache.data = {
      scwAddress: saAddress,
      address: owner.address,
      pk: privKeyHex,
    };
    await cache.write();
  }
  return { signer, smartWallet };
};

// https://docs.biconomy.io/tutorials/sendGasless
const aaSendContract = async (smartWallet, to: Address) => {
  console.log('Smart Account: send a Smart Contract transaction');
  try {
    const NFT_CONTRACT_ADDRESS = process.env.SEPOLIA_NFT_ADDRESS as `0x${string}`;

    // Build the transaction
    // @ts-ignore
    const data = encodeFunctionData({
      abi: nftContractAbi,
      functionName: 'mint',
      args: [to],
    });
    const tx = {
      to: NFT_CONTRACT_ADDRESS,
      data: data,
    };
    console.log('Transaction data', tx);

    // Send the transaction and get the transaction hash
    const userOpResponse = await smartWallet.sendTransaction(tx, {
      paymasterServiceData: { mode: PaymasterMode.SPONSORED },
    });
    const { transactionHash } = await userOpResponse.waitForTxHash();
    console.log('Transaction Hash', transactionHash);
    const userOpReceipt = await userOpResponse.wait();
    // if (userOpReceipt.success == 'true') {
    //   console.log('UserOp receipt', JSON.stringify(userOpReceipt));
    //   console.log('Transaction receipt', JSON.stringify(userOpReceipt.receipt));
    // }
    console.log('Transaction receipt success:', userOpReceipt.success);
  } catch (e) {
    console.error('aaSendContract:', e.message);
  }
};

const processScript = async () => {
  const { signer, smartWallet } = await initUser();
  await aaSendContract(smartWallet, signer.account.address);
  // Demo: https://sepolia.etherscan.io/tx/0xfad689913049c24fa1ef7e4759db007f3978f43f8efcbecd95cbe65769e3edd2
};

processScript()
  .then(() => {
    console.log('DONE');
    process.exit(0);
  })
  .catch((error) => console.error(error));
