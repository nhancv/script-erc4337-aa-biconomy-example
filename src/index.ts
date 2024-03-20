require('dotenv').config();
import { JSONFile, Low } from '@commonify/lowdb';

import { Address, createWalletClient, encodeFunctionData, Hex, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import {
  BiconomySmartAccountV2,
  createSmartAccountClient,
  IHybridPaymaster,
  PaymasterFeeQuote,
  PaymasterMode,
  SponsorUserOperationDto,
} from '@biconomy/account';

import nftContractAbi from './abis/NFTContract.json';

const chain = baseSepolia;
const biconomyPaymasterApiKey = process.env.BICONOMY_PAYMASTER_API_KEY as string;
const bundlerUrl = process.env.BICONOMY_BUNDLER_URL as string;
const feeTokenAddress = '0x7683022d84F726a96c4A6611cD31DBf5409c0Ac9'; // Base Sepolia DAI

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

/**
 * Send ETH from Smart Account to another address
 * Requires the Smart Account to have enough ETH balance
 */
const buildSendETHTransaction = (ethReceiver: Address, ethValue = parseEther('0.001')) => {
  console.log('Send ETH:', ethReceiver, ethValue);
  return {
    to: ethReceiver,
    data: '0x',
    value: ethValue,
  };
};

/**
 * Send Token from Smart Account to another address
 * Requires the Smart Account to have enough Token balance
 * The TOKEN contract must be whitelisted in the Biconomy -> Paymaster -> Rule -> Contract: transfer, approve
 */
const buildSendTokenTransaction = (token: Address, tokenReceiver: Address) => {
  console.log('Send Token:', token, tokenReceiver);
  // @ts-ignore
  const data = encodeFunctionData({
    abi: JSON.parse(
      '[{"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}]',
    ),
    functionName: 'transfer',
    args: [tokenReceiver, parseEther('1')],
  });
  return {
    to: token,
    data: data,
  };
};

/**
 * Mint NFT to another address
 * The NFT contract must be whitelisted in the Biconomy -> Paymaster -> Rule -> Contract: mint
 */
const buildMintNFTTransaction = (nftReceiver: Address) => {
  console.log('Mint NFT:', nftReceiver);

  const NFT_CONTRACT_ADDRESS = process.env.SEPOLIA_NFT_ADDRESS as `0x${string}`;
  // @ts-ignore
  const data = encodeFunctionData({
    abi: nftContractAbi,
    functionName: 'mint',
    args: [nftReceiver],
  });
  return {
    to: NFT_CONTRACT_ADDRESS,
    data: data,
  };
};

/**
 * Requires setup Gas-Tank with enough ETH balance to pay gas fees
 */
const sendTransactionUseETHSponsored = async (smartWallet: BiconomySmartAccountV2, tx: any) => {
  return smartWallet.sendTransaction(tx, {
    paymasterServiceData: { mode: PaymasterMode.SPONSORED },
  });
};

/**
 * Requires:
 * + Setup Gas-Tank is required, but the deposit amount will not be used for gas fees
 * + Whitelist the Fee Payment Token in the Biconomy -> Paymaster -> Rule -> Token: transfer, approve
 * + Requires the Smart Account to have enough Token balance to pay gas fees
 */
const sendTransactionUseTokenSponsored = async (smartWallet: BiconomySmartAccountV2, tx: any) => {
  // Send the transaction and get the transaction hash
  const biconomyPaymaster = smartWallet.paymaster as IHybridPaymaster<SponsorUserOperationDto>;
  const userOp = await smartWallet.buildUserOp([tx]);
  const feeQuotesResponse = await biconomyPaymaster.getPaymasterFeeQuotesOrData(userOp, {
    mode: PaymasterMode.ERC20,
    tokenList: [feeTokenAddress],
  });
  const feeQuotes = feeQuotesResponse.feeQuotes as PaymasterFeeQuote[];
  const spender = feeQuotesResponse.tokenPaymasterAddress;
  const selectedFeeQuote = feeQuotes[0];
  // Should override the max gas fee with more 20% to increase the success rate
  selectedFeeQuote.maxGasFee = selectedFeeQuote.maxGasFee * 1.2;
  console.log(`maxGasFee: ${selectedFeeQuote.maxGasFee}, exchangeRate: ${selectedFeeQuote['exchangeRate']}`);
  // console.log('selectedFeeQuote', selectedFeeQuote);
  const finalUserOp = await smartWallet.buildTokenPaymasterUserOp(userOp, {
    feeQuote: selectedFeeQuote as any,
    spender: spender!,
    maxApproval: false,
  });
  const paymasterServiceData = {
    mode: PaymasterMode.ERC20,
    feeTokenAddress: selectedFeeQuote.tokenAddress,
    calculateGasLimits: true, // Always recommended and especially when using token paymaster
  };
  const paymasterAndDataResponse = await biconomyPaymaster.getPaymasterAndData(finalUserOp, paymasterServiceData);
  finalUserOp.paymasterAndData = paymasterAndDataResponse.paymasterAndData;
  finalUserOp.callGasLimit = paymasterAndDataResponse.callGasLimit;
  finalUserOp.verificationGasLimit = paymasterAndDataResponse.verificationGasLimit;
  finalUserOp.preVerificationGas = paymasterAndDataResponse.preVerificationGas;

  return smartWallet.sendUserOp(finalUserOp);
};

// https://docs.biconomy.io/tutorials/sendGasless
const aaSendContract = async (smartWallet: BiconomySmartAccountV2, to: Address, useETHSponsor = true) => {
  console.log('Smart Account: send a Smart Contract transaction');
  try {
    const tx = buildMintNFTTransaction(to);
    // const tx = buildSendETHTransaction(to);
    // const tx = buildSendTokenTransaction(feeTokenAddress, to);
    console.log('Transaction data', tx);

    // Send the transaction and get the transaction hash
    const userOpResponse = useETHSponsor
      ? await sendTransactionUseETHSponsored(smartWallet, tx)
      : await sendTransactionUseTokenSponsored(smartWallet, tx);

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

  /// Sponsor by ETH
  // await aaSendContract(smartWallet, signer.account.address, true);
  // Mint NFT: https://sepolia.basescan.org/tx/0x4eeb67bdf10456a72a622e396c867b48e8ca68ef90af5ccbfc8f628e69706b2a
  // Send ETH: https://sepolia.basescan.org/tx/0x531cee5482725d80f304a3f352fecef988ab5c1af974bb5daf98f5b8d3851754
  // Send DAI: https://sepolia.basescan.org/tx/0xf25081f890c3e9ee5ce56265f90a87f836fcb8d167c6e7a087ab24f1f3daa5eb

  /// Sponsor by DAI
  await aaSendContract(smartWallet, signer.account.address, false);
  // Mint NFT: https://sepolia.basescan.org/tx/0x2317dad180f737ad94ae30561a7b52a7dfb1b55206a860a70293bb57d458fe32
  // Send ETH: https://sepolia.basescan.org/tx/0x6983bd121fa48d4ead3098dad35a8244409db30694d3e16e0fbb61e06f8b5713
  // Send DAI: https://sepolia.basescan.org/tx/0x8637a83f77747520c3765bff879b5315a8d27c3fe0a0b521d9fe8d65cb54b155
};

processScript()
  .then(() => {
    console.log('DONE');
    process.exit(0);
  })
  .catch((error) => console.error(error));
